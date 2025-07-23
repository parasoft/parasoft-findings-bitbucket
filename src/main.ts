import * as minimist from "minimist";
import * as runner from "./runner";
import {messages, messagesFormatter} from './messages';
import {logger, configureLogger} from "./logger";

export async function run(): Promise<void> {
    const args = minimist(process.argv.slice(2), {
         boolean: ['debug'],
         string: ['report', 'parasoftToolOrJavaRootPath'],
    });

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

        const theRunner = new runner.StaticAnalysisParserRunner();
        await theRunner.run(runOptions);

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