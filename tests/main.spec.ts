import * as sinon from 'sinon';
import * as main from '../src/main';
import * as runner from '../src/runner';
import {messages, messagesFormatter} from '../src/messages';
import {logger} from '../src/logger';
import {beforeEach} from "mocha";

describe('parasoft-bitbucket/main', () => {
    describe('run()', () => {
        let sandbox: sinon.SinonSandbox;

        let log: sinon.SinonSpy;
        let logInfo: sinon.SinonSpy;
        let logError: sinon.SinonSpy;

        let format: sinon.SinonSpy;
        let exit: sinon.SinonStub;
        let fakeStaticAnalysisParserRunner: sinon.SinonSpy;
        let customOption: runner.RunOptions;
        let runnerExitCode: number;

        beforeEach(() => {
            sandbox = sinon.createSandbox();

            log = sinon.fake();
            sandbox.replace(console, 'log', log);
            logInfo = sandbox.fake();
            sandbox.replace(logger, 'info', logInfo);
            logError = sandbox.fake();
            sandbox.replace(logger, 'error', logError);
            format = sandbox.fake();
            sandbox.replace(messagesFormatter, 'format', format);
            exit = sandbox.stub(process, 'exit');
            runnerExitCode = 0;
            customOption = {
                report: "D:/test/report.xml",
                parasoftToolOrJavaRootPath: "C:/Java"
            }
        });

        afterEach(() => {
            exit.restore();
            sandbox.restore();
            process.argv = [];
        });

        const setBitbucketEnv = () => {
            process.env.USER_EMAIL = 'user@mail.com';
            process.env.API_TOKEN = 'api-token';
            process.env.BITBUCKET_REPO_SLUG = 'repo';
            process.env.BITBUCKET_COMMIT = 'commit';
            process.env.BITBUCKET_WORKSPACE = 'workspace';
            process.env.BITBUCKET_CLONE_DIR = __dirname;
            process.env.BITBUCKET_API_URL = 'https://api.bitbucket.org/2.0/repositories';
        };

        const setUpFakeRunner = (fakeRunner: sinon.SinonSpy) => {
            fakeStaticAnalysisParserRunner = fakeRunner;
            sandbox.replace(runner.StaticAnalysisParserRunner.prototype, 'run', fakeStaticAnalysisParserRunner);
        }

        it('show help', () => {
            process.argv = ['node', 'dist/script.js', '--help'];
            main.run();

            sinon.assert.calledWith(log,
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
        parasoft-findings-bitbucket --report "</path/to/report.xml>" --parasoftToolOrJavaRootPath "<path/to/parasoft/tool/installation/dir>" --debug`);
        });

        it('show version', () => {
            process.argv = ['node', 'dist/script.js', '--version'];
            main.run();

            sinon.assert.calledWith(log, '1.0.0');
            sinon.assert.calledWith(exit, 0);

        });

        it('Parse static analysis report with exit code 0', async () => {
            process.argv = ['node', 'dist/script.js', '--report=D:/test/report.xml', '--parasoftToolOrJavaRootPath=C:/Java'];
            setBitbucketEnv();
            setUpFakeRunner(sandbox.fake.resolves({exitCode: runnerExitCode}));

            await main.run();

            sinon.assert.notCalled(logError);
            sinon.assert.calledWith(fakeStaticAnalysisParserRunner, customOption);
            sinon.assert.calledWith(logInfo, messagesFormatter.format(messages.complete, runnerExitCode));
        });

        it('Missing --report', async () => {
            process.argv = ['node', 'dist/script.js', '--parasoftToolOrJavaRootPath=C:/Java'];

            await main.run();

            sinon.assert.called(logError);
            sinon.assert.calledWith(logError, messagesFormatter.format(messages.missing_parameter, '--report'));
        });

        it('Missing --parasoftToolOrJavaRootPath and java home', async () => {
            const javahome = process.env.JAVA_HOME;
            try {
                delete process.env.JAVA_HOME;

                process.argv = ['node', 'dist/script.js', '--report=D:/test/report.xml'];
                setBitbucketEnv();

                await main.run();

                sinon.assert.calledWith(exit, 1);
                sinon.assert.calledWith(logError, messagesFormatter.format(messages.missing_parameter, '--report'));
            } finally {
                process.env.JAVA_HOME = javahome;
            }
        });

        it('Parse static analysis failed', async () => {
            process.argv = ['node', 'dist/script.js', '--report=D:/test/report.xml', '--parasoftToolOrJavaRootPath=C:/Java'];
            const error = new Error('Parse failed');
            setUpFakeRunner(sinon.fake.throws(error));

            await main.run();

            sinon.assert.calledWith(logError, error);
        });
    });
});