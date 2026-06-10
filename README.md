lensinfra
=================

Command line tool for Infra


[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/lensinfra.svg)](https://npmjs.org/package/lensinfra)
[![Downloads/week](https://img.shields.io/npm/dw/lensinfra.svg)](https://npmjs.org/package/lensinfra)


<!-- toc -->
* [Usage](#usage)
* [Commands](#commands)
<!-- tocstop -->
# Usage
<!-- usage -->
```sh-session
$ npm install -g lensinfra
$ lensinfra COMMAND
running command...
$ lensinfra (--version)
lensinfra/0.0.0 win32-x64 node-v20.20.2
$ lensinfra --help [COMMAND]
USAGE
  $ lensinfra COMMAND
...
```
<!-- usagestop -->
# Commands
<!-- commands -->
* [`lensinfra hello PERSON`](#lensinfra-hello-person)
* [`lensinfra hello world`](#lensinfra-hello-world)
* [`lensinfra help [COMMAND]`](#lensinfra-help-command)
* [`lensinfra plugins`](#lensinfra-plugins)
* [`lensinfra plugins add PLUGIN`](#lensinfra-plugins-add-plugin)
* [`lensinfra plugins:inspect PLUGIN...`](#lensinfra-pluginsinspect-plugin)
* [`lensinfra plugins install PLUGIN`](#lensinfra-plugins-install-plugin)
* [`lensinfra plugins link PATH`](#lensinfra-plugins-link-path)
* [`lensinfra plugins remove [PLUGIN]`](#lensinfra-plugins-remove-plugin)
* [`lensinfra plugins reset`](#lensinfra-plugins-reset)
* [`lensinfra plugins uninstall [PLUGIN]`](#lensinfra-plugins-uninstall-plugin)
* [`lensinfra plugins unlink [PLUGIN]`](#lensinfra-plugins-unlink-plugin)
* [`lensinfra plugins update`](#lensinfra-plugins-update)

## `lensinfra hello PERSON`

Say hello

```
USAGE
  $ lensinfra hello PERSON -f <value>

ARGUMENTS
  PERSON  Person to say hello to

FLAGS
  -f, --from=<value>  (required) Who is saying hello

DESCRIPTION
  Say hello

EXAMPLES
  $ lensinfra hello friend --from oclif
  hello friend from oclif! (./src/commands/hello/index.ts)
```

_See code: [src/commands/hello/index.ts](https://github.com/lensinfra/lensinfra/blob/v0.0.0/src/commands/hello/index.ts)_

## `lensinfra hello world`

Say hello world

```
USAGE
  $ lensinfra hello world

DESCRIPTION
  Say hello world

EXAMPLES
  $ lensinfra hello world
  hello world! (./src/commands/hello/world.ts)
```

_See code: [src/commands/hello/world.ts](https://github.com/lensinfra/lensinfra/blob/v0.0.0/src/commands/hello/world.ts)_

## `lensinfra help [COMMAND]`

Display help for lensinfra.

```
USAGE
  $ lensinfra help [COMMAND...] [-n]

ARGUMENTS
  [COMMAND...]  Command to show help for.

FLAGS
  -n, --nested-commands  Include all nested commands in the output.

DESCRIPTION
  Display help for lensinfra.
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/6.2.50/src/commands/help.ts)_

## `lensinfra plugins`

List installed plugins.

```
USAGE
  $ lensinfra plugins [--json] [--core]

FLAGS
  --core  Show core plugins.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List installed plugins.

EXAMPLES
  $ lensinfra plugins
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.73/src/commands/plugins/index.ts)_

## `lensinfra plugins add PLUGIN`

Installs a plugin into lensinfra.

```
USAGE
  $ lensinfra plugins add PLUGIN... [--json] [-f] [-h] [-s | -v]

ARGUMENTS
  PLUGIN...  Plugin to install.

FLAGS
  -f, --force    Force npm to fetch remote resources even if a local copy exists on disk.
  -h, --help     Show CLI help.
  -s, --silent   Silences npm output.
  -v, --verbose  Show verbose npm output.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Installs a plugin into lensinfra.

  Uses npm to install plugins.

  Installation of a user-installed plugin will override a core plugin.

  Use the LENSINFRA_NPM_LOG_LEVEL environment variable to set the npm loglevel.
  Use the LENSINFRA_NPM_REGISTRY environment variable to set the npm registry.

ALIASES
  $ lensinfra plugins add

EXAMPLES
  Install a plugin from npm registry.

    $ lensinfra plugins add myplugin

  Install a plugin from a github url.

    $ lensinfra plugins add https://github.com/someuser/someplugin

  Install a plugin from a github slug.

    $ lensinfra plugins add someuser/someplugin
```

## `lensinfra plugins:inspect PLUGIN...`

Displays installation properties of a plugin.

```
USAGE
  $ lensinfra plugins inspect PLUGIN...

ARGUMENTS
  PLUGIN...  [default: .] Plugin to inspect.

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Displays installation properties of a plugin.

EXAMPLES
  $ lensinfra plugins inspect myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.73/src/commands/plugins/inspect.ts)_

## `lensinfra plugins install PLUGIN`

Installs a plugin into lensinfra.

```
USAGE
  $ lensinfra plugins install PLUGIN... [--json] [-f] [-h] [-s | -v]

ARGUMENTS
  PLUGIN...  Plugin to install.

FLAGS
  -f, --force    Force npm to fetch remote resources even if a local copy exists on disk.
  -h, --help     Show CLI help.
  -s, --silent   Silences npm output.
  -v, --verbose  Show verbose npm output.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Installs a plugin into lensinfra.

  Uses npm to install plugins.

  Installation of a user-installed plugin will override a core plugin.

  Use the LENSINFRA_NPM_LOG_LEVEL environment variable to set the npm loglevel.
  Use the LENSINFRA_NPM_REGISTRY environment variable to set the npm registry.

ALIASES
  $ lensinfra plugins add

EXAMPLES
  Install a plugin from npm registry.

    $ lensinfra plugins install myplugin

  Install a plugin from a github url.

    $ lensinfra plugins install https://github.com/someuser/someplugin

  Install a plugin from a github slug.

    $ lensinfra plugins install someuser/someplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.73/src/commands/plugins/install.ts)_

## `lensinfra plugins link PATH`

Links a plugin into the CLI for development.

```
USAGE
  $ lensinfra plugins link PATH [-h] [--install] [-v]

ARGUMENTS
  PATH  [default: .] path to plugin

FLAGS
  -h, --help          Show CLI help.
  -v, --verbose
      --[no-]install  Install dependencies after linking the plugin.

DESCRIPTION
  Links a plugin into the CLI for development.

  Installation of a linked plugin will override a user-installed or core plugin.

  e.g. If you have a user-installed or core plugin that has a 'hello' command, installing a linked plugin with a 'hello'
  command will override the user-installed or core plugin implementation. This is useful for development work.


EXAMPLES
  $ lensinfra plugins link myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.73/src/commands/plugins/link.ts)_

## `lensinfra plugins remove [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ lensinfra plugins remove [PLUGIN...] [-h] [-v]

ARGUMENTS
  [PLUGIN...]  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ lensinfra plugins unlink
  $ lensinfra plugins remove

EXAMPLES
  $ lensinfra plugins remove myplugin
```

## `lensinfra plugins reset`

Remove all user-installed and linked plugins.

```
USAGE
  $ lensinfra plugins reset [--hard] [--reinstall]

FLAGS
  --hard       Delete node_modules and package manager related files in addition to uninstalling plugins.
  --reinstall  Reinstall all plugins after uninstalling.
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.73/src/commands/plugins/reset.ts)_

## `lensinfra plugins uninstall [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ lensinfra plugins uninstall [PLUGIN...] [-h] [-v]

ARGUMENTS
  [PLUGIN...]  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ lensinfra plugins unlink
  $ lensinfra plugins remove

EXAMPLES
  $ lensinfra plugins uninstall myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.73/src/commands/plugins/uninstall.ts)_

## `lensinfra plugins unlink [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ lensinfra plugins unlink [PLUGIN...] [-h] [-v]

ARGUMENTS
  [PLUGIN...]  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ lensinfra plugins unlink
  $ lensinfra plugins remove

EXAMPLES
  $ lensinfra plugins unlink myplugin
```

## `lensinfra plugins update`

Update installed plugins.

```
USAGE
  $ lensinfra plugins update [-h] [-v]

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Update installed plugins.
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.73/src/commands/plugins/update.ts)_
<!-- commandsstop -->
