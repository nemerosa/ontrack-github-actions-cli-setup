const os = require('os');
const fs = require('fs');
const path = require('path');

const core = require('@actions/core');
const tc = require('@actions/tool-cache');
const io = require('@actions/io');
const exec = require('@actions/exec');
const github = require('@actions/github');

const readYaml = require('read-yaml-promise');

(async () => {
    try {
        await setup();
    } catch (error) {
        core.setFailed(error.message);
    }
})();

async function setup() {

    // Checks the owner
    const onlyFor = core.getInput('only-for')
    const cliDisabled = (onlyFor && onlyFor !== github.context.repo.owner)
    if (cliDisabled) {
        console.log(`Ontrack setup not eligible for the ${github.context.repo.owner} repository owner.`)
        console.log("The Ontrack CLI is still downloaded, but will be disabled.")
    }

    // Gets the version, if available
    let version = core.getInput('version');
    if (!version) {
        console.log("No version provided. Getting the latest version from GitHub.")
        const githubToken = core.getInput("github-token")
        if (!githubToken) {
            throw "GitHub token must be provided in order to get the latest version of the CLI."
        }
        const octokit = github.getOctokit(githubToken)
        const releases = await octokit.rest.repos.listReleases({
            owner: "nemerosa",
            repo: "ontrack-cli"
        })
        const release = releases.data.find(release => !release.draft && !release.prerelease)
        if (!release) {
            throw "No release found for ontrack-cli"
        }
        version = release.name
    }
    console.log(`Using version: ${version}`);
    core.setOutput('installed', version);

    // Information about the OS
    const osPlatform = mapOS(os.platform());
    const osArch = mapArch(os.arch());
    console.log(`For OS platform: ${osPlatform}`);
    console.log(`For OS arch: ${osArch}`);

    const majorVersion = parseInt(version.split(".").at(0), 10);
    const cliName = majorVersion >= 5 ? "yontrack" : "ontrack-cli";

    // Getting the URL to the CLI
    const downloadUrl = `https://github.com/nemerosa/ontrack-cli/releases/download/${version}/${cliName}-${osPlatform}-${osArch}`;
    console.log(`Downloading CLI from ${downloadUrl}`);

    // Downloading
    await downloadAndSetup(downloadUrl)

    // GitHub repository (name) ==> Ontrack project
    const project = github.context.repo.repo;
    core.setOutput('project', project);
    console.log(`Ontrack project = ${project}`);

    // GitHub branch
    let branch = '';
    const branchOverride = core.getInput('branch')
    if (branchOverride) {
        branch = branchOverride
    } else {
        console.log(`GitHub ref = ${github.context.ref}`);
        const branchPrefix = 'refs/heads/';
        const tagPrefix = 'refs/tags/';
        const prPrefix = 'refs/pull/'
        const prSuffix = '/merge'
        if (github.context.ref.startsWith(branchPrefix)) {
            branch = github.context.ref.substring(branchPrefix.length);
        } else if (github.context.ref.startsWith(tagPrefix)) {
            branch = github.context.ref.substring(tagPrefix.length);
        } else if (github.context.ref.startsWith(prPrefix) && github.context.ref.endsWith(prSuffix)) {
            const prNumber = github.context.ref.substring(prPrefix.length, github.context.ref.length - prSuffix.length)
            branch = `PR-${prNumber}`
        } else {
            throw `Unsupported ref format: ${github.context.ref}`;
        }
    }
    core.setOutput('branch', branch);
    console.log(`Ontrack branch = ${branch}`);

    // CLI config?
    const url = core.getInput('url')
    const token = core.getInput('token')
    const connRetryCount = core.getInput('conn-retry-count')
    const connRetryWait = core.getInput('conn-retry-wait')
    console.log(`Ontrack URL set to ${url}`)
    console.log(`Ontrack token set to ${token ? token.length : 0} characters`)
    if (url && token) {
        let name = core.getInput('name')
        if (!name) name = 'prod'
        await configureCLI(url, token, name, cliDisabled, connRetryCount, connRetryWait)

        // Name of the GitHub configuration in Ontrack
        const config = core.getInput('config')
        if (config) {
            await configureProject(config, project, branch)
        }
    }
}

async function configureCLI(url, token, name, cliDisabled, connRetryCount, connRetryWait) {
    let args = ['config', 'create', name, url, '--token', token]
    if (connRetryCount) {
        args.push('--conn-retry-count', connRetryCount)
    }
    if (connRetryWait) {
        args.push('--conn-retry-wait', connRetryWait)
    }
    await exec.exec('ontrack-cli', args)
    // Disabling the CLI
    if (cliDisabled) {
        await exec.exec('ontrack-cli', ['config', 'disable', name])
    }
}

async function configureProject(config, project, branch) {
    console.log(`Configuring branch for config ${config}...`)

    // GitHub context
    const context = github.context;
    console.log(`GitHub context = ${context}`);

    // Branch setup
    if (branch) {

        let setupArgs = ['branch', 'setup', '--project', project, '--branch', branch]

        let autoVS = core.getInput("auto-validation-stamps")
        if (autoVS === true || autoVS === 'true') {
            setupArgs.push("--auto-create-vs")
        } else if (autoVS === 'force') {
            setupArgs.push("--auto-create-vs", "--auto-create-vs-always")
        } else if (autoVS === false || autoVS === 'false') {
            setupArgs.push("--auto-create-vs=false")
        }

        let autoPL = core.getInput("auto-promotion-levels")
        if (autoPL === true || autoPL === 'true') {
            setupArgs.push("--auto-create-pl")
        } else if (autoPL === false || autoPL === 'false') {
            setupArgs.push("--auto-create-pl=false")
        }

        await exec.exec('ontrack-cli', setupArgs)

        let indexation = core.getInput('indexation');
        if (!indexation) indexation = 0

        let issueService = core.getInput('issue-service')
        if (!issueService) issueService = 'self'

        await exec.exec('ontrack-cli', ['project', 'set-property', '--project', project, 'github', '--configuration', config, '--repository', `${context.repo.owner}/${context.repo.repo}`, '--indexation', indexation, '--issue-service', issueService])
        await exec.exec('ontrack-cli', ['branch', 'set-property', '--project', project, '--branch', branch, 'git', '--git-branch', branch])

        await configureAutoPromotion(project, branch)
    }
}

async function configureAutoPromotion(project, branch) {
    const promotionsPath = core.getInput("promotions")
    if (promotionsPath) {
        // Reads the file as YAML
        const yaml = await readYaml(promotionsPath)
        // List of validations and promotions to setup
        const validations = []
        const promotions = []
        // Collects all the validation to setup
        for (const promotion in yaml) {
            if (Object.prototype.hasOwnProperty.call(yaml, promotion)) {
                promotions.push(promotion)
                const promotionConfig = yaml[promotion]
                if (promotionConfig.validations) {
                    promotionConfig.validations.forEach(validation => {
                        validations.push(validation)
                    })
                }
            }
        }
        // Creates all the validations
        await validations.forEach(validation => {
            exec.exec('ontrack-cli', ['validation', 'setup', 'generic', '--project', project, '--branch', branch, '--validation', validation])
        })
        // Creates all the promotions
        await promotions.forEach(promotion => {
            exec.exec('ontrack-cli', ['promotion', 'setup', '--project', project, '--branch', branch, '--promotion', promotion])
        })
        // Auto promotion setup
        for (const promotion in yaml) {
            if (Object.prototype.hasOwnProperty.call(yaml, promotion)) {
                const promotionConfig = yaml[promotion]
                const setupArgs = ['promotion', 'setup', '--project', project, '--branch', branch, '--promotion', promotion]
                if (promotionConfig.validations) {
                    promotionConfig.validations.forEach(validation => {
                        setupArgs.push('--validation', validation)
                    })
                }
                if (promotionConfig.promotions) {
                    promotionConfig.promotions.forEach(promotion => {
                        setupArgs.push('--depends-on', promotion)
                    })
                }
                await exec.exec('ontrack-cli', setupArgs)
            }
        }
    }
}

async function downloadAndSetup(url) {
    const cliPath = await tc.downloadTool(url);
    console.log(`Downloaded at ${cliPath}`)

    // Make the download executable
    if (!os.platform().startsWith('win')) {
        await fs.chmodSync(cliPath, '766')
    }

    const dir = path.dirname(cliPath)
    console.log(`Directory is ${dir}`)

    // If we're on Windows, then the executable ends with .exe
    const exeSuffix = os.platform().startsWith('win') ? '.exe' : '';

    await io.mv(cliPath, [dir, `ontrack-cli${exeSuffix}`].join(path.sep))

    // Add to the path
    core.addPath(dir)
}

// arch in [arm, x32, x64...] (https://nodejs.org/api/os.html#os_os_arch)
// return value in [amd64, 386, arm]
function mapArch(arch) {
    const mappings = {
        x32: '386',
        x64: 'amd64'
    };
    return mappings[arch] || arch;
}

// os in [darwin, linux, win32...] (https://nodejs.org/api/os.html#os_os_platform)
// return value in [darwin, linux, windows]
function mapOS(os) {
    const mappings = {
        win32: 'windows'
    };
    return mappings[os] || os;
}
