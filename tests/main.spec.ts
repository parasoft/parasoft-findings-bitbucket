import * as sinon from 'sinon';
import * as main from '../src/main';
import * as runner from '../src/runner';
import {messages, messagesFormatter} from '../src/messages';
import {logger} from '../src/logger';

describe('parasoft-bitbucket/main', () => {
    describe('run', () => {
        const sandbox = sinon.createSandbox();
        let logInfo: sinon.SinonSpy;
        let logError: sinon.SinonSpy;
        let format: sinon.SinonSpy;
        let exit: (code?: string | number | null | undefined) => never;
        let fakeStaticAnalysisParserRunner: sinon.SinonSpy;
        let customOption: runner.RunOptions;
        let runnerExitCode: number;

        beforeEach(() => {
            logInfo = sandbox.fake();
            sandbox.replace(logger, 'info', logInfo);
            logError = sandbox.fake();
            sandbox.replace(logger, 'error', logError);
            format = sandbox.fake();
            sandbox.replace(messagesFormatter, 'format', format);
            exit = sandbox.fake() as (code?: string | number | null | undefined) => never;
            sandbox.replace(process, 'exit', exit);
            runnerExitCode = 0;
            customOption = {
                report: "D:/test/report.xml",
                parasoftToolOrJavaRootPath: "C:/Java",
            }
        });

        afterEach(() => {
            sandbox.restore();
            process.argv = [];
        });

        const setUpFakeRunner = (fakeRunner: sinon.SinonSpy) => {
            fakeStaticAnalysisParserRunner = fakeRunner;
            sandbox.replace(runner.StaticAnalysisParserRunner.prototype, 'run', fakeStaticAnalysisParserRunner);
            sandbox.stub(runner.StaticAnalysisParserRunner.prototype, 'getBitbucketEnvs' as any)
                .returns({API_TOKEN: "", USER_EMAIL: "", BITBUCKET_COMMIT: "", BITBUCKET_REPO_SLUG: "", BITBUCKET_WORKSPACE: "", BITBUCKET_CLONE_DIR: "", BITBUCKET_API_URL: ""});
        }

        it('Parse static analysis report with exit code 0', async () => {
            process.argv = ['node', 'dist/script.js', '--report=D:/test/report.xml', '--parasoftToolOrJavaRootPath=C:/Java'];
            setUpFakeRunner(sandbox.fake.resolves({exitCode: runnerExitCode}));

            await main.run();

            sinon.assert.notCalled(logError);
            sinon.assert.calledWith(fakeStaticAnalysisParserRunner, customOption);
            sinon.assert.calledWith(logInfo, messagesFormatter.format(messages.complete, runnerExitCode));
        });

        it('Missing report', async () => {
            process.argv = ['node', 'dist/script.js', '--parasoftToolOrJavaRootPath=C:/Java'];
            setUpFakeRunner(sandbox.fake.resolves({exitCode: runnerExitCode}));

            await main.run();

            sinon.assert.called(logError);
            sinon.assert.calledWith(logError, messagesFormatter.format(messages.missing_parameter, '--report'));
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