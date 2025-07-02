import * as minimist from "minimist";
import * as runner from "./runner";
import {messages, messagesFormatter} from './messages';
import {logger, configureLogger} from "./logger";

export async function run(): Promise<void> {
    const args = minimist(process.argv.slice(2));

    // Configure log level to DEBUG if the '--debug' parameter is set
    if (args['debug']) {
        configureLogger({ level: 'debug' });
    }

    try {
        const runOptions: runner.RunOptions = {
            report: args['report'],
            parasoftToolOrJavaRootPath: args['parasoftToolOrJavaRootPath']
        };

        const theRunner = new runner.StaticAnalysisParserRunner();
        const outcome = await theRunner.run(runOptions);

        if (outcome.exitCode != 0) {
            logger.error(messagesFormatter.format(messages.failed_convert_report, outcome.exitCode));
            process.exit(1);
        }
        logger.info(messagesFormatter.format(messages.exit_code, outcome.exitCode));
    } catch (error) {
        logger.error(messagesFormatter.format(messages.run_failed, args['report']));
        if (error instanceof Error) {
            logger.info(error.message);
            logger.error(error);
        }
        process.exit(1);
    }
}

if (require.main === module) {
    run();
}