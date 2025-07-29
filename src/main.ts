import * as minimist from 'minimist';
import * as runner from './runner';
import * as pkg from '../package.json';
import {messages, messagesFormatter} from './messages';
import {logger, configureLogger} from './logger';

export interface BitbucketEnvs {
    USER_EMAIL: string;
    API_TOKEN: string;
    BITBUCKET_REPO_SLUG: string;
    BITBUCKET_COMMIT: string;
    BITBUCKET_WORKSPACE: string;
    BITBUCKET_CLONE_DIR: string;
    BITBUCKET_API_URL: string;
}

export async function run(): Promise<void> {
    const args = minimist(process.argv.slice(2), {
        boolean: ['debug', 'help', 'version'],
        string: ['report', 'parasoftToolOrJavaRootPath'],
    });

    if (args['version']) {
        console.log(pkg.version);
        process.exit(0);
    }

    // Show help messages if no parameters are set or '--help' parameter is set
    if (process.argv.length <= 2 || args['help']) {
        showHelp();
        process.exit(0);
    }

    // Configure log level to DEBUG if the '--debug' parameter is set
    if (args['debug']) {
        configureLogger({ level: 'debug' });
    }

    try {
        const runOptions: runner.RunOptions = {
            report: args['report'],
            parasoftToolOrJavaRootPath: args['parasoftToolOrJavaRootPath']
        };

        if (!runOptions.report || runOptions.report.trim().length == 0) {
            logger.error(messagesFormatter.format(messages.missing_parameter, '--report'));
            process.exit(1);
        }

        if (!runOptions.parasoftToolOrJavaRootPath && !process.env.JAVA_HOME) {
            logger.error(messagesFormatter.format(messages.missing_parameter, '--parasoftToolOrJavaRootPath'));
            process.exit(1);
        }

        const bitbucketEnvs = getBitbucketEnvs();

        const theRunner = new runner.StaticAnalysisParserRunner();
        await theRunner.run(runOptions, bitbucketEnvs);

        logger.info(messagesFormatter.format(messages.complete));
    } catch (error) {
        if (error instanceof Error) {
            logger.error(error);
        } else {
            logger.error(messagesFormatter.format(messages.run_failed, args['report']));
        }
        process.exit(1);
    }
}

if (require.main === module) {
    run();
}

function showHelp() {
    console.log(
        `    Usage: parasoft-findings-bitbucket --report <xmlReportPath> [--parasoftToolOrJavaRootPath <javaInstallDirPath>] [--debug]

    Options:
        --report                            Path or minimatch pattern to locate Parasoft static analysis report files. (required)
        --parasoftToolOrJavaRootPath        Path to Java installation or Parasoft tool (required if JAVA_HOME not set) for report processing.
        --debug                             Enable debug logging.
        --version                           Print version number and exit.
        --help                              Show this help information and exit.

    Examples:
        parasoft-findings-bitbucket --report "</path/to/report.xml>"
        parasoft-findings-bitbucket --report "</path/to/report.xml>" --parasoftToolOrJavaRootPath "<path/to/java_home>"
        parasoft-findings-bitbucket --report "</path/to/report.xml>" --parasoftToolOrJavaRootPath "<path/to/parasoft/tool/installation/dir>" --debug`
    );
}

function getBitbucketEnvs(): BitbucketEnvs {
    const requiredEnvs: BitbucketEnvs = {
        USER_EMAIL: process.env.USER_EMAIL || '',
        API_TOKEN: process.env.API_TOKEN || '',
        BITBUCKET_REPO_SLUG: process.env.BITBUCKET_REPO_SLUG || '',
        BITBUCKET_COMMIT: process.env.BITBUCKET_COMMIT || '',
        BITBUCKET_WORKSPACE: process.env.BITBUCKET_WORKSPACE || '',
        BITBUCKET_CLONE_DIR: process.env.BITBUCKET_CLONE_DIR || '',
        BITBUCKET_API_URL: 'https://api.bitbucket.org/2.0/repositories'
    }

    const missingEnvs = Object.keys(requiredEnvs).filter(key => requiredEnvs[key as keyof BitbucketEnvs] == '');
    if (missingEnvs.length > 0) {
        throw new Error(messagesFormatter.format(messages.missing_required_environment_variables, missingEnvs.join(', ')));
    }

    return requiredEnvs;
}