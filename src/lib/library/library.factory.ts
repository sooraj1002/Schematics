import {
  join,
  normalize,
  parseJson,
  Path,
  strings,
} from '@angular-devkit/core';
import {
  apply,
  branchAndMerge,
  chain,
  mergeWith,
  move,
  Rule,
  SchematicsException,
  Source,
  template,
  Tree,
  url,
} from '@angular-devkit/schematics';
import {
  DEFAULT_LANGUAGE,
  DEFAULT_LIB_PATH,
  DEFAULT_PATH_NAME,
  PROJECT_TYPE,
} from '../defaults';
import { LibraryOptions } from './library.schema';

type UpdateJsonFn<T> = (obj: T) => T | void;
interface TsConfigPartialType {
  compilerOptions: {
    baseUrl: string;
    paths: {
      [key: string]: string[];
    };
  };
}

export function main(options: LibraryOptions): Rule {
  options = transform(options);
  return chain([
    updatePackageJson(options),
    updateTsConfig(options.name, options.prefix, options.path),
    addLibraryToCliOptions(options.path, options.name),
    branchAndMerge(mergeWith(generate(options))),
  ]);
}

function transform(options: LibraryOptions): LibraryOptions {
  const target: LibraryOptions = Object.assign({}, options);
  const defaultSourceRoot =
    options.rootDir !== undefined ? options.rootDir : DEFAULT_LIB_PATH;

  if (!target.name) {
    throw new SchematicsException('Option (name) is required.');
  }
  target.language = !!target.language ? target.language : DEFAULT_LANGUAGE;
  target.name = strings.dasherize(target.name);
  target.path =
    target.path !== undefined
      ? join(normalize(defaultSourceRoot), target.path)
      : normalize(defaultSourceRoot);

  target.prefix = target.prefix || '@app';
  return target;
}

function updatePackageJson(options: LibraryOptions) {
  return (host: Tree) => {
    if (!host.exists('package.json')) {
      return host;
    }
    return updateJsonFile(
      host,
      'package.json',
      (packageJson: Record<string, any>) => {
        // tslint:disable:no-unused-expression
        packageJson.scripts && updateNpmScripts(packageJson.scripts);
      },
    );
  };
}

function updateNpmScripts(scripts: Record<string, any>) {
  const defaultFormatScriptName = 'format';
  if (!scripts[defaultFormatScriptName]) {
    return;
  }
  if (
    scripts[defaultFormatScriptName] &&
    scripts[defaultFormatScriptName].indexOf(DEFAULT_PATH_NAME) >= 0
  ) {
    scripts[defaultFormatScriptName] =
      'prettier --write "src/**/*.ts" "test/**/*.ts" "libs/**/*.ts"';
  }
}

function updateJsonFile<T>(
  host: Tree,
  path: string,
  callback: UpdateJsonFn<T>,
): Tree {
  const source = host.read(path);
  if (source) {
    const sourceText = source.toString('utf-8');
    const json = parseJson(sourceText);
    callback((json as {}) as T);
    host.overwrite(path, JSON.stringify(json, null, 2));
  }

  return host;
}

function updateTsConfig(
  packageName: string,
  packagePrefix: string,
  root: string,
) {
  return (host: Tree) => {
    if (!host.exists('tsconfig.json')) {
      return host;
    }
    const distRoot = join(root as Path, packageName, 'src');
    const packageKey = packagePrefix
      ? packagePrefix + '/' + packageName
      : packageName;

    return updateJsonFile(
      host,
      'tsconfig.json',
      (tsconfig: TsConfigPartialType) => {
        if (!tsconfig.compilerOptions) {
          tsconfig.compilerOptions = {} as any;
        }
        if (!tsconfig.compilerOptions.baseUrl) {
          tsconfig.compilerOptions.baseUrl = './';
        }
        if (!tsconfig.compilerOptions.paths) {
          tsconfig.compilerOptions.paths = {};
        }
        if (!tsconfig.compilerOptions.paths[packageKey]) {
          tsconfig.compilerOptions.paths[packageKey] = [];
        }
        tsconfig.compilerOptions.paths[packageKey].push(distRoot);

        const deepPackagePath = packageKey + '/*';
        if (!tsconfig.compilerOptions.paths[deepPackagePath]) {
          tsconfig.compilerOptions.paths[deepPackagePath] = [];
        }
        tsconfig.compilerOptions.paths[deepPackagePath].push(distRoot + '/*');
      },
    );
  };
}

function addLibraryToCliOptions(
  projectRoot: string,
  projectName: string,
): Rule {
  const project = {
    type: PROJECT_TYPE.LIBRARY,
    root: join(projectRoot as Path, projectName),
    sourceRoot: join(projectRoot as Path, projectName, 'src'),
  };
  return (host: Tree) => {
    const nestFileExists = host.exists('nest.json');

    let nestCliFileExists = host.exists('nest-cli.json');
    if (!nestCliFileExists && !nestFileExists) {
      host.create('nest-cli.json', '{}');
      nestCliFileExists = true;
    }
    return updateJsonFile(
      host,
      nestCliFileExists ? 'nest-cli.json' : 'nest.json',
      (optionsFile: Record<string, any>) => {
        if (!optionsFile.projects) {
          optionsFile.projects = {} as any;
        }
        optionsFile.projects[projectName] = project;
      },
    );
  };
}

function generate(options: LibraryOptions): Source {
  const path = join(options.path as Path, options.name);

  return apply(url(join('./files' as Path, options.language)), [
    template({
      ...strings,
      ...options,
    }),
    move(path),
  ]);
}
