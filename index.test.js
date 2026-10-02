jest.mock('fs', () => {
    const actual = jest.requireActual('fs');
    return {
        ...actual,
        promises: {
            ...actual.promises,
            chmod: jest.fn().mockResolvedValue(undefined),
        },
    };
});

const {
    runAction,
    configureCLI,
    configureProject,
    mapArch,
    mapOS,
    argsWithConfig,
    downloadAndSetup,
} = require('./index');

function makeCore(inputs = {}) {
    return {
        getInput: jest.fn((name) => (name in inputs ? inputs[name] : '')),
        setOutput: jest.fn(),
        setFailed: jest.fn(),
        addPath: jest.fn(),
    };
}

function makeExec() {
    return { exec: jest.fn().mockResolvedValue(0) };
}

function makeGithub({
    repo = 'my-repo',
    owner = 'my-org',
    ref = 'refs/heads/main',
    sha = 'abc123',
    listReleasesData = [{ name: '5.0.0', draft: false, prerelease: false }],
} = {}) {
    return {
        context: { repo: { owner, repo }, ref, sha },
        getOctokit: jest.fn(() => ({
            rest: {
                repos: {
                    listReleases: jest.fn().mockResolvedValue({ data: listReleasesData }),
                },
            },
        })),
    };
}

function makeTc(downloadResult = '/tmp/cli-download') {
    return {
        downloadTool: jest.fn().mockResolvedValue(downloadResult),
        find: jest.fn().mockReturnValue(''),
        isExplicitVersion: jest.fn((version) => /^\d+\.\d+\.\d+$/.test(version)),
        cacheFile: jest.fn().mockResolvedValue('/tool-cache/ontrack-cli/5.0.0/x64'),
    };
}

describe('mapArch', () => {
    test('maps x32 to 386', () => { expect(mapArch('x32')).toBe('386'); });
    test('maps x64 to amd64', () => { expect(mapArch('x64')).toBe('amd64'); });
    test('passes other values through', () => { expect(mapArch('arm64')).toBe('arm64'); });
});

describe('mapOS', () => {
    test('maps win32 to windows', () => { expect(mapOS('win32')).toBe('windows'); });
    test('passes other values through', () => { expect(mapOS('linux')).toBe('linux'); });
});

describe('argsWithConfig', () => {
    test('returns unchanged args when no configFilePath', () => {
        expect(argsWithConfig(['a', 'b'], '')).toEqual(['a', 'b']);
    });

    test('appends --config flag when configFilePath provided', () => {
        expect(argsWithConfig(['a', 'b'], '/path/to/config.yml')).toEqual(['a', 'b', '--config', '/path/to/config.yml']);
    });
});

describe('configureCLI', () => {
    test('calls config create with name, url, token', async () => {
        const execDep = makeExec();
        await configureCLI({ exec: execDep, url: 'https://yt.example', token: 'tok123', name: 'myConfig', cliDisabled: false, connRetryCount: '', connRetryWait: '', configFilePath: '' });
        expect(execDep.exec).toHaveBeenCalledWith('ontrack-cli', ['config', 'create', 'myConfig', 'https://yt.example', '--token', 'tok123']);
    });

    test('appends conn-retry args when provided', async () => {
        const execDep = makeExec();
        await configureCLI({ exec: execDep, url: 'https://yt.example', token: 'tok123', name: 'prod', cliDisabled: false, connRetryCount: '5', connRetryWait: '10', configFilePath: '' });
        expect(execDep.exec).toHaveBeenCalledWith('ontrack-cli', expect.arrayContaining(['--conn-retry-count', '5', '--conn-retry-wait', '10']));
    });

    test('disables config when cliDisabled is true', async () => {
        const execDep = makeExec();
        await configureCLI({ exec: execDep, url: 'https://yt.example', token: 'tok123', name: 'prod', cliDisabled: true, connRetryCount: '', connRetryWait: '', configFilePath: '' });
        expect(execDep.exec).toHaveBeenCalledTimes(2);
        expect(execDep.exec).toHaveBeenLastCalledWith('ontrack-cli', ['config', 'disable', 'prod']);
    });

    test('passes --config flag when configFilePath provided', async () => {
        const execDep = makeExec();
        await configureCLI({ exec: execDep, url: 'https://yt.example', token: 'tok123', name: 'prod', cliDisabled: false, connRetryCount: '', connRetryWait: '', configFilePath: '/cfg.yml' });
        expect(execDep.exec).toHaveBeenCalledWith('ontrack-cli', expect.arrayContaining(['--config', '/cfg.yml']));
    });
});

describe('configureProject', () => {
    test('runs branch setup with --auto-create-vs when auto-validation-stamps is true', async () => {
        const core = makeCore({ 'auto-validation-stamps': 'true' });
        const execDep = makeExec();
        const github = makeGithub();
        await configureProject({ core, exec: execDep, github, config: 'github.com', project: 'my-repo', branch: 'main', configFilePath: '' });
        const branchSetupCall = execDep.exec.mock.calls.find((c) => c[1].includes('setup'));
        expect(branchSetupCall[1]).toEqual(expect.arrayContaining(['--auto-create-vs']));
    });

    test('runs branch setup with --auto-create-vs and --auto-create-vs-always when force', async () => {
        const core = makeCore({ 'auto-validation-stamps': 'force' });
        const execDep = makeExec();
        const github = makeGithub();
        await configureProject({ core, exec: execDep, github, config: 'github.com', project: 'my-repo', branch: 'main', configFilePath: '' });
        const branchSetupCall = execDep.exec.mock.calls.find((c) => c[1].includes('setup'));
        expect(branchSetupCall[1]).toEqual(expect.arrayContaining(['--auto-create-vs', '--auto-create-vs-always']));
    });

    test('skips work when branch is empty', async () => {
        const core = makeCore();
        const execDep = makeExec();
        const github = makeGithub();
        await configureProject({ core, exec: execDep, github, config: 'github.com', project: 'my-repo', branch: '', configFilePath: '' });
        expect(execDep.exec).not.toHaveBeenCalled();
    });
});

describe('runAction — branch resolution from ref', () => {
    test('parses branch name from refs/heads/*', async () => {
        const core = makeCore({ version: '5.0.0' });
        const execDep = makeExec();
        const github = makeGithub({ ref: 'refs/heads/feature/foo' });
        const tc = makeTc();
        await runAction({ core, exec: execDep, github, tc });
        expect(core.setOutput).toHaveBeenCalledWith('branch', 'feature/foo');
    });

    test('parses tag name from refs/tags/*', async () => {
        const core = makeCore({ version: '5.0.0' });
        const execDep = makeExec();
        const github = makeGithub({ ref: 'refs/tags/v1.2.3' });
        const tc = makeTc();
        await runAction({ core, exec: execDep, github, tc });
        expect(core.setOutput).toHaveBeenCalledWith('branch', 'v1.2.3');
    });

    test('builds PR-N from refs/pull/N/merge', async () => {
        const core = makeCore({ version: '5.0.0' });
        const execDep = makeExec();
        const github = makeGithub({ ref: 'refs/pull/42/merge' });
        const tc = makeTc();
        await runAction({ core, exec: execDep, github, tc });
        expect(core.setOutput).toHaveBeenCalledWith('branch', 'PR-42');
    });

    test('uses branch input override when provided', async () => {
        const core = makeCore({ version: '5.0.0', branch: 'override-branch' });
        const execDep = makeExec();
        const github = makeGithub({ ref: 'refs/heads/main' });
        const tc = makeTc();
        await runAction({ core, exec: execDep, github, tc });
        expect(core.setOutput).toHaveBeenCalledWith('branch', 'override-branch');
    });

    test('throws on unsupported ref format', async () => {
        const core = makeCore({ version: '5.0.0' });
        const execDep = makeExec();
        const github = makeGithub({ ref: 'refs/something-else/foo' });
        const tc = makeTc();
        await expect(runAction({ core, exec: execDep, github, tc })).rejects.toThrow('Unsupported ref format: refs/something-else/foo');
    });
});

describe('runAction — version resolution', () => {
    test('uses provided version input when set', async () => {
        const core = makeCore({ version: '4.5.6' });
        const execDep = makeExec();
        const github = makeGithub();
        const tc = makeTc();
        await runAction({ core, exec: execDep, github, tc });
        expect(core.setOutput).toHaveBeenCalledWith('installed', '4.5.6');
        expect(github.getOctokit).not.toHaveBeenCalled();
    });

    test('throws if no version provided and no github-token', async () => {
        const core = makeCore();
        const execDep = makeExec();
        const github = makeGithub();
        const tc = makeTc();
        await expect(runAction({ core, exec: execDep, github, tc })).rejects.toThrow('GitHub token must be provided');
    });

    test('queries octokit when no version provided but github-token is', async () => {
        const core = makeCore({ 'github-token': 'gh-token-xyz' });
        const execDep = makeExec();
        const github = makeGithub({ listReleasesData: [{ name: '5.1.2', draft: false, prerelease: false }] });
        const tc = makeTc();
        await runAction({ core, exec: execDep, github, tc });
        expect(github.getOctokit).toHaveBeenCalledWith('gh-token-xyz');
        expect(core.setOutput).toHaveBeenCalledWith('installed', '5.1.2');
    });

    test('skips draft and prerelease releases', async () => {
        const core = makeCore({ 'github-token': 'gh-token-xyz' });
        const execDep = makeExec();
        const github = makeGithub({
            listReleasesData: [
                { name: '6.0.0-rc.1', draft: false, prerelease: true },
                { name: '5.5.0-draft', draft: true, prerelease: false },
                { name: '5.0.0', draft: false, prerelease: false },
            ],
        });
        const tc = makeTc();
        await runAction({ core, exec: execDep, github, tc });
        expect(core.setOutput).toHaveBeenCalledWith('installed', '5.0.0');
    });

    test('throws when no non-draft, non-prerelease releases exist', async () => {
        const core = makeCore({ 'github-token': 'gh-token-xyz' });
        const execDep = makeExec();
        const github = makeGithub({
            listReleasesData: [{ name: '6.0.0-rc.1', draft: false, prerelease: true }],
        });
        const tc = makeTc();
        await expect(runAction({ core, exec: execDep, github, tc })).rejects.toThrow('No release found for ontrack-cli');
    });
});

describe('runAction — only-for gate', () => {
    test('marks CLI disabled when only-for does not match repo owner', async () => {
        const core = makeCore({ version: '5.0.0', 'only-for': 'some-other-org', url: 'https://yt.example', token: 'tok' });
        const execDep = makeExec();
        const github = makeGithub({ owner: 'my-org' });
        const tc = makeTc();
        await runAction({ core, exec: execDep, github, tc });
        const disableCall = execDep.exec.mock.calls.find((c) => c[1].includes('disable'));
        expect(disableCall).toBeDefined();
    });

    test('does not disable CLI when only-for matches repo owner', async () => {
        const core = makeCore({ version: '5.0.0', 'only-for': 'my-org', url: 'https://yt.example', token: 'tok' });
        const execDep = makeExec();
        const github = makeGithub({ owner: 'my-org' });
        const tc = makeTc();
        await runAction({ core, exec: execDep, github, tc });
        const disableCall = execDep.exec.mock.calls.find((c) => c[1].includes('disable'));
        expect(disableCall).toBeUndefined();
    });
});

describe('runAction — project output', () => {
    test('sets project output to repo name', async () => {
        const core = makeCore({ version: '5.0.0' });
        const execDep = makeExec();
        const github = makeGithub({ repo: 'my-cool-repo' });
        const tc = makeTc();
        await runAction({ core, exec: execDep, github, tc });
        expect(core.setOutput).toHaveBeenCalledWith('project', 'my-cool-repo');
    });
});

describe('downloadAndSetup', () => {
    test('reuses the CLI from the tool cache when the version is already there', async () => {
        const core = makeCore();
        const tc = makeTc();
        tc.find.mockReturnValue('/tool-cache/ontrack-cli/5.9.0/x64');
        await downloadAndSetup({ tc, core, downloadUrl: 'https://example/cli', version: '5.9.0' });
        expect(tc.find).toHaveBeenCalledWith('ontrack-cli', '5.9.0');
        expect(tc.downloadTool).not.toHaveBeenCalled();
        expect(core.addPath).toHaveBeenCalledWith('/tool-cache/ontrack-cli/5.9.0/x64');
    });

    test('does not look in the tool cache when the version is not an exact one', async () => {
        const core = makeCore();
        const tc = makeTc();
        tc.find.mockReturnValue('/tool-cache/ontrack-cli/5.9.0/x64');
        await downloadAndSetup({ tc, core, downloadUrl: 'https://example/cli', version: '5' });
        expect(tc.find).not.toHaveBeenCalled();
        expect(tc.downloadTool).toHaveBeenCalledWith('https://example/cli');
    });

    test('downloads the CLI and stores it in the tool cache when it is not cached yet', async () => {
        const core = makeCore();
        const tc = makeTc('/tmp/cli-download');
        tc.cacheFile.mockResolvedValue('/tool-cache/ontrack-cli/5.9.0/x64');
        await downloadAndSetup({ tc, core, downloadUrl: 'https://example/cli', version: '5.9.0' });
        expect(tc.downloadTool).toHaveBeenCalledWith('https://example/cli');
        expect(tc.cacheFile).toHaveBeenCalledWith('/tmp/cli-download', expect.stringMatching(/^ontrack-cli(\.exe)?$/), 'ontrack-cli', '5.9.0');
        expect(core.addPath).toHaveBeenCalledWith('/tool-cache/ontrack-cli/5.9.0/x64');
    });

    test('retries the download after a failure, waiting between attempts', async () => {
        const core = makeCore();
        const tc = makeTc('/tmp/cli-download');
        tc.downloadTool
            .mockRejectedValueOnce(new Error('socket hang up'))
            .mockRejectedValueOnce(new Error('Unexpected HTTP response: 504'))
            .mockResolvedValueOnce('/tmp/cli-download');
        const sleep = jest.fn().mockResolvedValue(undefined);
        await downloadAndSetup({ tc, core, downloadUrl: 'https://example/cli', version: '5.9.0', retryCount: 2, retryWait: 7, sleep });
        expect(tc.downloadTool).toHaveBeenCalledTimes(3);
        expect(sleep.mock.calls).toEqual([[7], [7]]);
        expect(tc.cacheFile).toHaveBeenCalledWith('/tmp/cli-download', expect.any(String), 'ontrack-cli', '5.9.0');
    });

    test('fails with the last error once all retries are exhausted', async () => {
        const core = makeCore();
        const tc = makeTc();
        tc.downloadTool.mockRejectedValue(new Error('Unexpected HTTP response: 504'));
        const sleep = jest.fn().mockResolvedValue(undefined);
        await expect(downloadAndSetup({ tc, core, downloadUrl: 'https://example/cli', version: '5.9.0', retryCount: 2, retryWait: 1, sleep }))
            .rejects.toThrow('Unexpected HTTP response: 504');
        expect(tc.downloadTool).toHaveBeenCalledTimes(3);
        expect(core.addPath).not.toHaveBeenCalled();
    });

    test('does not retry when the download fails with a client error such as 404', async () => {
        const core = makeCore();
        const tc = makeTc();
        const notFound = Object.assign(new Error('Unexpected HTTP response: 404'), { httpStatusCode: 404 });
        tc.downloadTool.mockRejectedValue(notFound);
        const sleep = jest.fn().mockResolvedValue(undefined);
        await expect(downloadAndSetup({ tc, core, downloadUrl: 'https://example/cli', version: '9.9.9', retryCount: 3, retryWait: 1, sleep }))
            .rejects.toThrow('Unexpected HTTP response: 404');
        expect(tc.downloadTool).toHaveBeenCalledTimes(1);
        expect(sleep).not.toHaveBeenCalled();
    });
});

describe('runAction — CLI download', () => {
    test('looks up the resolved version in the tool cache before downloading', async () => {
        const core = makeCore({ version: '5.9.0' });
        const tc = makeTc();
        tc.find.mockReturnValue('/tool-cache/ontrack-cli/5.9.0/x64');
        await runAction({ core, exec: makeExec(), github: makeGithub(), tc });
        expect(tc.find).toHaveBeenCalledWith('ontrack-cli', '5.9.0');
        expect(tc.downloadTool).not.toHaveBeenCalled();
    });

    test('retries the download as many times as download-retry-count', async () => {
        const core = makeCore({ version: '5.9.0', 'download-retry-count': '2', 'download-retry-wait': '0' });
        const tc = makeTc();
        tc.downloadTool
            .mockRejectedValueOnce(new Error('read ECONNRESET'))
            .mockRejectedValueOnce(new Error('socket hang up'))
            .mockResolvedValueOnce('/tmp/cli-download');
        await runAction({ core, exec: makeExec(), github: makeGithub(), tc });
        expect(tc.downloadTool).toHaveBeenCalledTimes(3);
        expect(core.addPath).toHaveBeenCalled();
    });

    test('does not retry the download by default', async () => {
        const core = makeCore({ version: '5.9.0' });
        const tc = makeTc();
        tc.downloadTool.mockRejectedValue(new Error('socket hang up'));
        await expect(runAction({ core, exec: makeExec(), github: makeGithub(), tc })).rejects.toThrow('socket hang up');
        expect(tc.downloadTool).toHaveBeenCalledTimes(1);
    });

    test.each([
        ['download-retry-count', 'abc'],
        ['download-retry-count', '-1'],
        ['download-retry-wait', '1.5'],
    ])('rejects an invalid %s value "%s"', async (input, value) => {
        const core = makeCore({ version: '5.9.0', [input]: value });
        const tc = makeTc();
        await expect(runAction({ core, exec: makeExec(), github: makeGithub(), tc }))
            .rejects.toThrow(`Input ${input} must be a non-negative integer, got: ${value}`);
        expect(tc.downloadTool).not.toHaveBeenCalled();
    });
});
