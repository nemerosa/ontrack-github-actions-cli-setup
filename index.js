const os = require('os');
const fs = require('fs');
const readYaml = require('read-yaml-promise');

// Name of the installed binary and of its tool cache entry (not the release asset name)
const CLI_TOOL_NAME = 'ontrack-cli';
const DEFAULT_DOWNLOAD_RETRY_WAIT = 30;

async function runAction({ core, exec, github, tc }) {
    const onlyFor = core.getInput('only-for');
    const cliDisabled = (onlyFor && onlyFor !== github.context.repo.owner);
    if (cliDisabled) {
        console.log(`Ontrack setup not eligible for the ${github.context.repo.owner} repository owner.`);
        console.log("The Ontrack CLI is still downloaded, but will be disabled.");
    }

    let version = core.getInput('version');
    if (!version) {
        console.log("No version provided. Getting the latest version from GitHub.");
        const githubToken = core.getInput("github-token");
        if (!githubToken) {
            throw new Error("GitHub token must be provided in order to get the latest version of the CLI.");
        }
        const octokit = github.getOctokit(githubToken);
        const releases = await octokit.rest.repos.listReleases({
            owner: "nemerosa",
            repo: "ontrack-cli",
        });
        const release = releases.data.find((r) => !r.draft && !r.prerelease);
        if (!release) {
            throw new Error("No release found for ontrack-cli");
        }
        version = release.name;
    }
    console.log(`Using version: ${version}`);
    core.setOutput('installed', version);

    const osPlatform = mapOS(os.platform());
    const osArch = mapArch(os.arch());
    console.log(`For OS platform: ${osPlatform}`);
    console.log(`For OS arch: ${osArch}`);

    const majorVersion = parseInt(version.split(".").at(0), 10);
    const cliName = majorVersion >= 5 ? "yontrack" : "ontrack-cli";

    const downloadRetryCount = parseNonNegativeIntInput(core, 'download-retry-count', 0);
    const downloadRetryWait = parseNonNegativeIntInput(core, 'download-retry-wait', DEFAULT_DOWNLOAD_RETRY_WAIT);

    const downloadUrl = `https://github.com/nemerosa/ontrack-cli/releases/download/${version}/${cliName}-${osPlatform}-${osArch}`;

    await downloadAndSetup({ tc, core, downloadUrl, version, retryCount: downloadRetryCount, retryWait: downloadRetryWait });

    const project = github.context.repo.repo;
    core.setOutput('project', project);
    console.log(`Ontrack project = ${project}`);

    let branch;
    const branchOverride = core.getInput('branch');
    if (branchOverride) {
        branch = branchOverride;
    } else {
        console.log(`GitHub ref = ${github.context.ref}`);
        const branchPrefix = 'refs/heads/';
        const tagPrefix = 'refs/tags/';
        const prPrefix = 'refs/pull/';
        const prSuffix = '/merge';
        if (github.context.ref.startsWith(branchPrefix)) {
            branch = github.context.ref.substring(branchPrefix.length);
        } else if (github.context.ref.startsWith(tagPrefix)) {
            branch = github.context.ref.substring(tagPrefix.length);
        } else if (github.context.ref.startsWith(prPrefix) && github.context.ref.endsWith(prSuffix)) {
            const prNumber = github.context.ref.substring(prPrefix.length, github.context.ref.length - prSuffix.length);
            branch = `PR-${prNumber}`;
        } else {
            throw new Error(`Unsupported ref format: ${github.context.ref}`);
        }
    }
    core.setOutput('branch', branch);
    console.log(`Ontrack branch = ${branch}`);

    const url = core.getInput('url');
    const token = core.getInput('token');
    const connRetryCount = core.getInput('conn-retry-count');
    const connRetryWait = core.getInput('conn-retry-wait');
    const configFilePath = core.getInput('config-file-path');
    console.log(`Ontrack URL set to ${url}`);
    console.log(`Ontrack token set to ${token ? token.length : 0} characters`);
    if (url && token) {
        let name = core.getInput('name');
        if (!name) name = 'prod';
        await configureCLI({ exec, url, token, name, cliDisabled, connRetryCount, connRetryWait, configFilePath });

        const config = core.getInput('config');
        if (config) {
            await configureProject({ core, exec, github, config, project, branch, configFilePath });
        }
    }
}

async function configureCLI({ exec, url, token, name, cliDisabled, connRetryCount, connRetryWait, configFilePath }) {
    const args = ['config', 'create', name, url, '--token', token];
    if (connRetryCount) {
        args.push('--conn-retry-count', connRetryCount);
    }
    if (connRetryWait) {
        args.push('--conn-retry-wait', connRetryWait);
    }
    await exec.exec('ontrack-cli', argsWithConfig(args, configFilePath));
    if (cliDisabled) {
        await exec.exec('ontrack-cli', argsWithConfig(['config', 'disable', name], configFilePath));
    }
}

async function configureProject({ core, exec, github, config, project, branch, configFilePath }) {
    console.log(`Configuring branch for config ${config}...`);

    const context = github.context;
    console.log(`GitHub context = ${context}`);

    if (branch) {
        const setupArgs = ['branch', 'setup', '--project', project, '--branch', branch];

        const autoVS = core.getInput("auto-validation-stamps");
        if (autoVS === true || autoVS === 'true') {
            setupArgs.push("--auto-create-vs");
        } else if (autoVS === 'force') {
            setupArgs.push("--auto-create-vs", "--auto-create-vs-always");
        } else if (autoVS === false || autoVS === 'false') {
            setupArgs.push("--auto-create-vs=false");
        }

        const autoPL = core.getInput("auto-promotion-levels");
        if (autoPL === true || autoPL === 'true') {
            setupArgs.push("--auto-create-pl");
        } else if (autoPL === false || autoPL === 'false') {
            setupArgs.push("--auto-create-pl=false");
        }

        await exec.exec('ontrack-cli', argsWithConfig(setupArgs, configFilePath));

        let indexation = core.getInput('indexation');
        if (!indexation) indexation = 0;

        let issueService = core.getInput('issue-service');
        if (!issueService) issueService = 'self';

        await exec.exec('ontrack-cli', argsWithConfig(['project', 'set-property', '--project', project, 'github', '--configuration', config, '--repository', `${context.repo.owner}/${context.repo.repo}`, '--indexation', indexation, '--issue-service', issueService], configFilePath));
        await exec.exec('ontrack-cli', argsWithConfig(['branch', 'set-property', '--project', project, '--branch', branch, 'git', '--git-branch', branch], configFilePath));

        await configureAutoPromotion({ core, exec, project, branch, configFilePath });
    }
}

async function configureAutoPromotion({ core, exec, project, branch, configFilePath }) {
    const promotionsPath = core.getInput("promotions");
    if (promotionsPath) {
        const yaml = await readYaml(promotionsPath);
        const validations = [];
        const promotions = [];
        for (const promotion in yaml) {
            if (Object.prototype.hasOwnProperty.call(yaml, promotion)) {
                promotions.push(promotion);
                const promotionConfig = yaml[promotion];
                if (promotionConfig.validations) {
                    promotionConfig.validations.forEach((validation) => {
                        validations.push(validation);
                    });
                }
            }
        }
        for (const validation of validations) {
            await exec.exec('ontrack-cli', argsWithConfig(['validation', 'setup', 'generic', '--project', project, '--branch', branch, '--validation', validation], configFilePath));
        }
        for (const promotion of promotions) {
            await exec.exec('ontrack-cli', argsWithConfig(['promotion', 'setup', '--project', project, '--branch', branch, '--promotion', promotion], configFilePath));
        }
        for (const promotion in yaml) {
            if (Object.prototype.hasOwnProperty.call(yaml, promotion)) {
                const promotionConfig = yaml[promotion];
                const setupArgs = ['promotion', 'setup', '--project', project, '--branch', branch, '--promotion', promotion];
                if (promotionConfig.validations) {
                    promotionConfig.validations.forEach((validation) => {
                        setupArgs.push('--validation', validation);
                    });
                }
                if (promotionConfig.promotions) {
                    promotionConfig.promotions.forEach((dep) => {
                        setupArgs.push('--depends-on', dep);
                    });
                }
                await exec.exec('ontrack-cli', argsWithConfig(setupArgs, configFilePath));
            }
        }
    }
}

async function downloadAndSetup({ tc, core, downloadUrl, version, retryCount = 0, retryWait = DEFAULT_DOWNLOAD_RETRY_WAIT, sleep = sleepSeconds }) {
    // tc.find treats a partial version such as "5" as a range, which could pick any cached 5.x.y
    const cachedDir = tc.isExplicitVersion(version) ? tc.find(CLI_TOOL_NAME, version) : '';
    if (cachedDir) {
        console.log(`Reusing CLI ${version} from the tool cache at ${cachedDir}`);
        core.addPath(cachedDir);
        return;
    }

    console.log(`Downloading CLI from ${downloadUrl}`);
    const cliPath = await downloadWithRetry({ tc, downloadUrl, retryCount, retryWait, sleep });
    console.log(`Downloaded at ${cliPath}`);

    if (!os.platform().startsWith('win')) {
        await fs.promises.chmod(cliPath, '766');
    }

    const exeSuffix = os.platform().startsWith('win') ? '.exe' : '';

    const dir = await tc.cacheFile(cliPath, `${CLI_TOOL_NAME}${exeSuffix}`, CLI_TOOL_NAME, version);
    console.log(`Cached at ${dir}`);

    core.addPath(dir);
}

// tc.downloadTool already makes 3 attempts on its own; these are extra rounds on top of it.
async function downloadWithRetry({ tc, downloadUrl, retryCount, retryWait, sleep }) {
    for (let retry = 0; ; retry++) {
        try {
            return await tc.downloadTool(downloadUrl);
        } catch (error) {
            if (retry >= retryCount || !isRetryableDownloadError(error)) {
                throw error;
            }
            console.log(`Download failed: ${error.message}`);
            console.log(`Retrying download (${retry + 1}/${retryCount}) in ${retryWait} seconds...`);
            await sleep(retryWait);
        }
    }
}

// Same rule as tc.downloadTool: client errors won't fix themselves, except 408 and 429.
function isRetryableDownloadError(error) {
    const status = error.httpStatusCode;
    return !status || status >= 500 || status === 408 || status === 429;
}

function sleepSeconds(seconds) {
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

function parseNonNegativeIntInput(core, name, defaultValue) {
    const value = core.getInput(name);
    if (!value) {
        return defaultValue;
    }
    if (!/^\d+$/.test(value)) {
        throw new Error(`Input ${name} must be a non-negative integer, got: ${value}`);
    }
    return parseInt(value, 10);
}

function mapArch(arch) {
    const mappings = { x32: '386', x64: 'amd64' };
    return mappings[arch] || arch;
}

function mapOS(osName) {
    const mappings = { win32: 'windows' };
    return mappings[osName] || osName;
}

function argsWithConfig(args, configFilePath) {
    if (configFilePath) {
        return [...args, '--config', configFilePath];
    }
    return args;
}

module.exports = {
    runAction,
    configureCLI,
    configureProject,
    configureAutoPromotion,
    downloadAndSetup,
    mapArch,
    mapOS,
    argsWithConfig,
};

if (process.env.NODE_ENV !== 'test') {
    (async () => {
        const core = await import('@actions/core');
        const execDep = await import('@actions/exec');
        const github = await import('@actions/github');
        const tc = await import('@actions/tool-cache');
        try {
            await runAction({ core, exec: execDep, github, tc });
        } catch (error) {
            core.setFailed(error.message);
        }
    })();
}
