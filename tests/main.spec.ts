import * as sinon from 'sinon';
import * as main from '../src/main';
import * as runner from '../src/runner';
import {messages, messagesFormatter} from '../src/messages';
import {logger} from '../src/logger';
import {beforeEach} from "mocha";

describe('main', () => {
    describe('run()', () => {
        let sandbox: sinon.SinonSandbox;

        let log: sinon.SinonSpy;
        let logInfo: sinon.SinonSpy;
        let logError: sinon.SinonSpy;

        let exit: sinon.SinonStub;
        let fakeStaticAnalysisParserRunner: sinon.SinonSpy;

        beforeEach(() => {
            sandbox = sinon.createSandbox();

            log = sinon.fake();
            sandbox.replace(console, 'log', log);
            logInfo = sandbox.fake();
            sandbox.replace(logger, 'info', logInfo);
            logError = sandbox.fake();
            sandbox.replace(logger, 'error', logError);
            exit = sandbox.stub(process, 'exit');
        });

        afterEach(() => {
            exit.restore();
            sandbox.restore();
            process.argv = [];
            clearBitbucketEnv();
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

        const clearBitbucketEnv = () => {
            delete process.env.USER_EMAIL;
            delete process.env.API_TOKEN;
            delete process.env.BITBUCKET_REPO_SLUG;
            delete process.env.BITBUCKET_COMMIT;
            delete process.env.BITBUCKET_WORKSPACE;
            delete process.env.BITBUCKET_CLONE_DIR;
            delete process.env.BITBUCKET_API_URL;
        };

        const setUpFakeRunner = (fakeRunner: sinon.SinonSpy) => {
            fakeStaticAnalysisParserRunner = fakeRunner;
            sandbox.replace(runner.StaticAnalysisParserRunner.prototype, 'run', fakeStaticAnalysisParserRunner);
        }

        it('show help', () => {
            process.argv = ['node', 'parasoft-findings-bitbucket', '--help'];
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
            process.argv = ['node', 'parasoft-findings-bitbucket', '--version'];
            main.run();

            sinon.assert.calledWith(log, '1.0.0');
            sinon.assert.calledWith(exit, 0);
        });

        it('Parse static analysis report successfully', async () => {
            process.argv = ['node', 'parasoft-findings-bitbucket', '--report=D:/test/report.xml', '--parasoftToolOrJavaRootPath=C:/Java', '--debug'];
            setBitbucketEnv();
            setUpFakeRunner(sandbox.fake.resolves("successfully parsed"));

            await main.run();

            sinon.assert.notCalled(logError);
            sinon.assert.calledWith(fakeStaticAnalysisParserRunner, {
                report: "D:/test/report.xml",
                parasoftToolOrJavaRootPath: "C:/Java"
            });
            sinon.assert.calledWith(logInfo, messagesFormatter.format(messages.complete));
            sinon.assert.match(logger.level, 'debug');
        });

        it('Missing --report', async () => {
            process.argv = ['node', 'parasoft-findings-bitbucket', '--parasoftToolOrJavaRootPath=C:/Java'];

            await main.run();

            sinon.assert.calledWith(exit, 1);
            sinon.assert.called(logError);
            sinon.assert.calledWith(logError, messagesFormatter.format(messages.missing_parameter, '--report'));
        });

        it('Missing --parasoftToolOrJavaRootPath and java home', async () => {
            const javahome = process.env.JAVA_HOME;
            try {
                delete process.env.JAVA_HOME;

                process.argv = ['node', 'parasoft-findings-bitbucket', '--report=D:/test/report.xml'];
                setBitbucketEnv();

                await main.run();

                sinon.assert.calledWith(exit, 1);
                sinon.assert.calledWith(logError, messagesFormatter.format(messages.missing_parameter, '--parasoftToolOrJavaRootPath'));
            } finally {
                process.env.JAVA_HOME = javahome;
            }
        });

        it('Parse static analysis failed', async () => {
            process.argv = ['node', 'parasoft-findings-bitbucket', '--report=D:/test/report.xml', '--parasoftToolOrJavaRootPath=C:/Java'];
            const error = new Error('Parse failed');
            setBitbucketEnv();
            setUpFakeRunner(sinon.fake.throws(error));

            await main.run();

            sinon.assert.calledWith(logError, error);
        });
        
        it('Missing required environment variables', async () => {
            process.argv = ['node', 'parasoft-findings-bitbucket', '--report=D:/test/report.xml', '--parasoftToolOrJavaRootPath=C:/Java'];

            await main.run();

            sinon.assert.calledWith(exit, 1);
            sinon.assert.called(logError);
            const arg = logError.firstCall.args[0];
            sinon.assert.match(arg.message, messagesFormatter.format(messages.missing_required_environment_variables, 'USER_EMAIL, API_TOKEN, BITBUCKET_REPO_SLUG, BITBUCKET_COMMIT, BITBUCKET_WORKSPACE, BITBUCKET_CLONE_DIR'));
        });
    });
});