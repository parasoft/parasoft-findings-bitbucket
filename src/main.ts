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
    BITBUCKET_PR_ID: string;
    BITBUCKET_BUILD_NUMBER: string;
}

export async function run(): Promise<void> {
    const args = minimist(process.argv.slice(2), {
        boolean: ['debug', 'help', 'version'],
        string: ['report', 'parasoftToolOrJavaRootPath', 'qualityGate']
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
            logger.error(messagesFormatter.format(messages.missing_required_parameter, '--report'));
            process.exit(1);
        }

        if (!runOptions.parasoftToolOrJavaRootPath && !process.env.JAVA_HOME) {
            logger.error(messagesFormatter.format(messages.missing_java_parameter, '--parasoftToolOrJavaRootPath'));
            process.exit(1);
        }

        if (args['qualityGate']?.length > 0) {
            const normalizedQualityGatePairs: string[] = Array.isArray(args['qualityGate']) ? args['qualityGate'] : [args['qualityGate']];
            runOptions.qualityGates = parseQualityGates(normalizedQualityGatePairs);

            logger.debug(messagesFormatter.format(messages.configured_quality_gates, JSON.stringify(runOptions.qualityGates)));
        } else {
            logger.debug(messagesFormatter.format(messages.no_quality_gate_is_configured));
        }

        const bitbucketEnvs = getBitbucketEnvs();

        const theRunner = new runner.StaticAnalysisParserRunner();
        const result = await theRunner.run(runOptions, bitbucketEnvs);

        logger.info(messagesFormatter.format(messages.complete));
        process.exit(result.exitCode);
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
        --qualityGate                       Specify a quality gate for a Bitbucket build. 
                                                The value must be in the format: 'BITBUCKET_SECURITY_LEVEL=THRESHOLD' (e.g., CRITICAL=1).
                                                Available security levels: ALL, CRITICAL, HIGH, MEDIUM, LOW.
        --debug                             Enable debug logging.
        --version                           Print version number and exit.
        --help                              Show this help information and exit.

    Examples:
        parasoft-findings-bitbucket --report "</path/to/report.xml>"
        parasoft-findings-bitbucket --report "</path/to/report.xml>" --parasoftToolOrJavaRootPath "<path/to/java_home>"
        parasoft-findings-bitbucket --report "</path/to/report.xml>" --parasoftToolOrJavaRootPath "<path/to/java_home>" --qualityGate "ALL=5" --qualityGate "CRITICAL=1"
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
        BITBUCKET_API_URL: 'https://api.bitbucket.org/2.0/repositories',
        BITBUCKET_PR_ID: process.env.BITBUCKET_PR_ID || '',
        BITBUCKET_BUILD_NUMBER: process.env.BITBUCKET_BUILD_NUMBER || ''
    }

    const missingEnvs = Object.keys(requiredEnvs).filter(key => requiredEnvs[key as keyof BitbucketEnvs] == '');
    if (missingEnvs.length > 0) {
        throw new Error(messagesFormatter.format(messages.missing_required_environment_variables, missingEnvs.join(', ')));
    }

    return requiredEnvs;
}

function parseQualityGates(qualityGatePairs: string[]): runner.QualityGates {
    const parsedQualityGates: runner.QualityGates = {};
    const qualityGateNames = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

    for (const qualityGatePair of qualityGatePairs) {
        const [qualityName, thresholdString] = qualityGatePair.split('=');
        const normalizedQualityName = qualityName.trim().toUpperCase();

        if (!qualityGateNames.includes(normalizedQualityName)) {
           logger.warn(messagesFormatter.format(messages.skipped_quality_gate_with_invalid_bitbucket_security_level, qualityGatePair, qualityName));
           continue;
        }

        if (thresholdString == undefined || thresholdString.trim() == '') {
            logger.warn(messagesFormatter.format(messages.skipped_quality_gate_with_empty_threshold, qualityGatePair, thresholdString));
            continue;
        }

        if (JSON.stringify(parsedQualityGates[normalizedQualityName])) {
            logger.warn(messagesFormatter.format(messages.skipped_quality_gate_with_same_bitbucket_security_level, qualityGatePair));
            continue;
        }

        const isPureNumber = new RegExp('^\\d+$').test(thresholdString);
        let threshold = undefined;
        if (!isPureNumber) {
            threshold = 0;
            logger.warn(messagesFormatter.format(messages.invalid_threshold_value_but_use_default_value, thresholdString, threshold));
        } else {
            threshold = parseInt(thresholdString);
        }
        if (threshold < 0) {
            threshold = 0;
            logger.warn(messagesFormatter.format(messages.threshold_value_less_than_zero_but_use_default_value, thresholdString, threshold));
        }

        parsedQualityGates[normalizedQualityName] = threshold;
    }

    return parsedQualityGates;
}