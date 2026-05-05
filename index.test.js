jest.mock('fs', () => {
    const actual = jest.requireActual('fs');
    return {
        ...actual,
        promises: {
            ...actual.promises,
            chmod: jest.fn().mockResolvedValue(undefined),
            rename: jest.fn().mockResolvedValue(undefined),
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
    return { downloadTool: jest.fn().mockResolvedValue(downloadResult) };
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
