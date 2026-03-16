# Ontrack GitHub actions: CLI setup

GitHub action to setup the [Ontrack CLI](https://github.com/nemerosa/ontrack-cli).

## Inputs

### `version`

Version of the [Ontrack CLI](https://github.com/nemerosa/ontrack-cli/releases) to install. If not specified, defaults to the latest available.

### `only-for`

Repository owner for which to activate the Ontrack setup.

This is useful when the Ontrack setup can only be done for a given organisation or user.

### `url`

URL of the Ontrack instance to target. If this input is set and the `token` one as well, this action will setup the CLI based on this information.

### `token`

Authentication token to use to connect to Ontrack (required if URL is set). If this input is set and the `url` one as well, this action will setup the CLI based on this information.

### `name`

Optional name of the configuration to create for the CLI. Defaults to `prod`.

### `config`

Optional name of the configuration in Ontrack holding the GitHub connection. If set, this action will setup the project and branch in Ontrack based on the available information.

### `indexation`

Indexation interval of the GitHub repository in GitHub (in minutes). Defaults to `0` (no indexation required).

### `github-token`

GitHub token to get the latest version of the CLI (when `version` is not provided).

### `auto-validation-stamps`

Sets the Ontrack project to create validation stamps on demand.

Value can be:

* `true` or `"true"` - auto creation based on predefined validation stamps
* `"force"` - auto creation even if no predefined validation stamps
* otherwise, no auto creation

### `auto-promotion-levels`

Sets the Ontrack project to create promotion levels on demand.

### `promotions`

Optional path to a YAML file describing the auto promotions for this project.

The target file format looks like:

```yaml
BRONZE:
  validations:
    - BUILD
SILVER:
  validations:
    - ACCEPTANCE
  promotions:
    - BRONZE
```

### `conn-retry-count`

Optional value to override max connection retry attempts. If not set, default ontrack-cli behavior applies. 

### `conn-retry-wait`

Optional value to override max wait time between connection retry attempts. If not set, default ontrack-cli behavior applies. 

### `branch`

Branch name in Yontrack, defaults to the branch derived from the `github.ref`

### `config-file-path`

Optional Yontrack configuration file path. If not set, default is yontrack-config.yaml in the current directory.

## Outputs

### `installed`

Version which has actually been installed.

### `project`

Name of the Ontrack project

### `branch`

Name of the Ontrack branch

## Example usage

Setting the CLI automatically:

```yaml
- name: Setup the CLI
  uses: nemerosa/ontrack-github-actions-cli-setup@v1
  with:
    github-token: ${{ github.token }}
    only-for: nemerosa
    url: <ontrack-url>
    token: ${{ secrets.ONTRACK_TOKEN }}
    config: github.com
    indexation: 120
# This:
# 1. installs the CLI
# 2. sets up the CLI
# 3. creates or updates the project in Ontrack
# 3. creates or updates the branch in Ontrack
# You can then use `ontrack-cli` directly
```

Setting a project and branch manually:

```yaml
- name: Setup the CLI
  uses: nemerosa/ontrack-github-actions-cli-setup@v1
# You can then use `ontrack-cli` directly
- name: Connect to Ontrack
  run:  ontrack-cli config create prod <ontrack-url> --token <token>
- name: Branch setup
  run:  ontrack-cli branch setup --project <project> --branch <branch>
```

See the [`ontrack-cli` documentation](https://github.com/nemerosa/ontrack-cli) for more examples.

## Associated actions

Other GitHub actions can be used after the `ontrack-github-actions-cli-setup` in order to leverage the Ontrack CLI:

* [`ontrack-github-actions-cli-build`](https://github.com/nemerosa/ontrack-github-actions-cli-build/) - complete setup of a build based on the GH workflow information
* [`ontrack-github-actions-cli-validation`](https://github.com/nemerosa/ontrack-github-actions-cli-validation/) - creates validations for builds, using information available in the GitHub workflow

## Building

Download the dependencies by running:

```bash
npm install
```

To build the distribution:

```bash
ncc build
```
