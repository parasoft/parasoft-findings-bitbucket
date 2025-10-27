import * as sinon from 'sinon';
import * as main from '../src/main';
import * as runner from '../src/runner';
import {messages, messagesFormatter} from '../src/messages';
import {logger} from '../src/logger';

describe('main', () => {
    describe('run()', () => {
        let sandbox: sinon.SinonSandbox;

        let log: sinon.SinonSpy;
        let logInfo: sinon.SinonSpy;
        let logWarn: sinon.SinonSpy;
        let logDebug: sinon.SinonSpy;
        let logError: sinon.SinonSpy;

        let exit: sinon.SinonStub;
        let fakeStaticAnalysisParserRunner: sinon.SinonSpy;

        beforeEach(() => {
            sandbox = sinon.createSandbox();

            log = sinon.fake();
            sandbox.replace(console, 'log', log);
            logInfo = sandbox.fake();
            sandbox.replace(logger, 'info', logInfo);
            logWarn = sandbox.fake();
            sandbox.replace(logger, 'warn', logWarn);
            logDebug = sandbox.fake();
            sandbox.replace(logger, 'debug', logDebug);
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
            process.env.BITBUCKET_PR_ID = '1';
            process.env.BITBUCKET_BUILD_NUMBER = '1';
        };

        const clearBitbucketEnv = () => {
            delete process.env.USER_EMAIL;
            delete process.env.API_TOKEN;
            delete process.env.BITBUCKET_REPO_SLUG;
            delete process.env.BITBUCKET_COMMIT;
            delete process.env.BITBUCKET_WORKSPACE;
            delete process.env.BITBUCKET_CLONE_DIR;
            delete process.env.BITBUCKET_API_URL;
            delete process.env.BITBUCKET_PR_ID;
            delete process.env.BITBUCKET_BUILD_NUMBER;
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
        --qualityGate                       Specify a quality gate for a Bitbucket build. 
                                                If the actual number of vulnerabilities is greater than or equal to the threshold, then the build is considered as failed.
                                                The value must be in the format: 'BITBUCKET_SECURITY_LEVEL=THRESHOLD' (e.g., CRITICAL=1).
                                                Available security levels: ALL, CRITICAL, HIGH, MEDIUM, LOW.
        --debug                             Enable debug logging.
        --version                           Print version number and exit.
        --help                              Show this help information and exit.

    Examples:
        parasoft-findings-bitbucket --report "</path/to/report.xml>"
        parasoft-findings-bitbucket --report "</path/to/report.xml>" --parasoftToolOrJavaRootPath "<path/to/java_home>"
        parasoft-findings-bitbucket --report "</path/to/report.xml>" --parasoftToolOrJavaRootPath "<path/to/java_home>" --qualityGate "ALL=5" --qualityGate "CRITICAL=1"
        parasoft-findings-bitbucket --report "</path/to/report.xml>" --parasoftToolOrJavaRootPath "<path/to/parasoft/tool/installation/dir>" --debug`);
        });

        it('show version', () => {
            process.argv = ['node', 'parasoft-findings-bitbucket', '--version'];
            main.run();

            sinon.assert.calledWith(log, '1.0.0');
            sinon.assert.calledWith(exit, 0);
        });

        it('parse static analysis report successfully without quality gate check', async () => {
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
            sinon.assert.calledWith(logDebug, messagesFormatter.format(messages.no_quality_gate_is_configured));
        });

        it('parse static analysis report successfully with quality gate check', async () => {
            process.argv = ['node', 'parasoft-findings-bitbucket', '--report=D:/test/report.xml', '--parasoftToolOrJavaRootPath=C:/Java', '--qualityGate', 'all=10', '--debug'];
            setBitbucketEnv();
            setUpFakeRunner(sandbox.fake.resolves("successfully parsed"));

            await main.run();

            sinon.assert.notCalled(logError);
            sinon.assert.calledWith(fakeStaticAnalysisParserRunner, {
                report: "D:/test/report.xml",
                parasoftToolOrJavaRootPath: "C:/Java",
                qualityGates: { ALL: 10 }
            });
            sinon.assert.calledWith(logInfo, messagesFormatter.format(messages.complete));
            sinon.assert.match(logger.level, 'debug');
            sinon.assert.calledWith(logDebug, messagesFormatter.format(messages.configured_quality_gates, '{"ALL":10}'));
        });

        it('should print error messages when parse static analysis failed', async () => {
            process.argv = ['node', 'parasoft-findings-bitbucket', '--report=D:/test/report.xml', '--parasoftToolOrJavaRootPath=C:/Java'];
            const error = new Error('Parse failed');
            setBitbucketEnv();
            setUpFakeRunner(sinon.fake.throws(error));

            await main.run();

            sinon.assert.calledWith(logError, error);
        });

        it('should exit with 1 when missing --report', async () => {
            process.argv = ['node', 'parasoft-findings-bitbucket', '--parasoftToolOrJavaRootPath=C:/Java'];

            await main.run();

            sinon.assert.calledWith(exit, 1);
            sinon.assert.called(logError);
            sinon.assert.calledWith(logError, messagesFormatter.format(messages.missing_required_parameter, '--report'));
        });

        it('should exit with 1 when missing --parasoftToolOrJavaRootPath and java home', async () => {
            const javahome = process.env.JAVA_HOME;
            try {
                delete process.env.JAVA_HOME;

                process.argv = ['node', 'parasoft-findings-bitbucket', '--report=D:/test/report.xml'];
                setBitbucketEnv();

                await main.run();

                sinon.assert.calledWith(exit, 1);
                sinon.assert.calledWith(logError, messagesFormatter.format(messages.missing_java_parameter, '--parasoftToolOrJavaRootPath'));
            } finally {
                process.env.JAVA_HOME = javahome;
            }
        });

        it('should exit with 1 when missing required environment variables', async () => {
            process.argv = ['node', 'parasoft-findings-bitbucket', '--report=D:/test/report.xml', '--parasoftToolOrJavaRootPath=C:/Java'];

            await main.run();

            sinon.assert.calledWith(exit, 1);
            sinon.assert.called(logError);
            const arg = logError.firstCall.args[0];
            sinon.assert.match(arg.message, messagesFormatter.format(messages.missing_required_environment_variables, 'USER_EMAIL, API_TOKEN, BITBUCKET_REPO_SLUG, BITBUCKET_COMMIT, BITBUCKET_WORKSPACE, BITBUCKET_CLONE_DIR, BITBUCKET_BUILD_NUMBER'));
        });

        describe('parseQualityGates()', async () => {
            beforeEach(() => {
                process.argv = ['node', 'parasoft-findings-bitbucket', '--report=D:/test/report.xml', '--parasoftToolOrJavaRootPath=C:/Java'];
            });

            it('should skip quality gate when bitbucket security level is invalid', async () => {
                process.argv.push('--qualityGate', 'invalid=10');

                await main.run();

                sinon.assert.called(logWarn);
                sinon.assert.calledWith(logWarn, messagesFormatter.format(messages.skipped_quality_gate_with_invalid_bitbucket_security_level, 'invalid=10', 'invalid'));
            });

            it('should use default value when threshold value is empty', async () => {
                process.argv.push('--qualityGate', 'all=');

                await main.run();

                sinon.assert.called(logWarn);
                sinon.assert.calledWith(logWarn, messagesFormatter.format(messages.invalid_threshold_value_but_use_default_value, '', 0));
            });

            it('should skip quality gate with same bitbucket security level', async () => {
                process.argv.push('--qualityGate', 'all=1', '--qualityGate', 'all=0');

                await main.run();

                sinon.assert.called(logWarn);
                sinon.assert.calledWith(logWarn, messagesFormatter.format(messages.skipped_quality_gate_with_same_bitbucket_security_level, 'all=0'));
            });

            it('should use default value when threshold value is invalid', async () => {
                process.argv.push('--qualityGate', 'all=invalid');

                await main.run();

                sinon.assert.called(logWarn);
                sinon.assert.calledWith(logWarn, messagesFormatter.format(messages.invalid_threshold_value_but_use_default_value, 'invalid', '0'));
            });

            it('should use default value when threshold value is less than 0', async () => {
                process.argv.push('--qualityGate', 'all=-1');

                await main.run();

                sinon.assert.called(logWarn);
                sinon.assert.calledWith(logWarn, messagesFormatter.format(messages.threshold_value_less_than_zero_but_use_default_value, '-1', '0'));
            });
        });
    });
});