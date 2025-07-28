import * as sinon from "sinon";
import {RunOptions, StaticAnalysisParserRunner} from "../src/runner";
import axios, {AxiosError, AxiosHeaders, AxiosResponse} from "axios";
import {logger} from "../src/logger";
import {messages, messagesFormatter} from "../src/messages";
import * as pt from 'path';
import * as cp from 'child_process';
import * as path from "node:path";
import * as fs from "node:fs";


describe('parasoft-bitbucket/runnner', () => {
    describe('run', () => {
        let sandbox: sinon.SinonSandbox;
        // logger
        let logInfo: sinon.SinonSpy;
        let logError: sinon.SinonSpy;
        let logWarn: sinon.SinonSpy;

        beforeEach(() => {
            sandbox = sinon.createSandbox();
            logInfo = sandbox.fake();
            sandbox.replace(logger, 'info', logInfo);
            logError = sandbox.fake();
            sandbox.replace(logger, 'error', logError);
            logWarn = sandbox.fake();
            sandbox.replace(logger, 'warn', logWarn);

            setBitbucketEnv();
        });

        afterEach(() => {
            sandbox.restore();
        })

        it('missing Bitbucket envs', async () => {
            setBitbucketEnv('');

            try {
                new StaticAnalysisParserRunner();
            } catch (error) {
                if (error instanceof Error) {
                    sinon.assert.match(error.message, messagesFormatter.format(messages.missing_required_environment_variables, ''));
                    return;
                }
                sinon.assert.fail("Expected error to be thrown but it was not.");
            }
            sinon.assert.fail("Expected error to be thrown but it was not.");
        });

        it('no static analysis reports found', async () => {
            const put = sandbox.fake.resolves({status: 200, data: {}});
            sandbox.replace(axios, 'put', put);
            const runOptions: RunOptions = {
                report: './res/reports/SARIF.*',
                parasoftToolOrJavaRootPath: '',
            };

            try {
                const staticAnalysisParserRunner = new StaticAnalysisParserRunner();
                await staticAnalysisParserRunner.run(runOptions);
            } catch (error) {
                if (error instanceof Error) {
                    sinon.assert.match(error.message, 'Parasoft XML Static Analysis report not found. No files matched the specified minimatch pattern or path: D:/github/parasoft-findings-bitbucket/tests/res/reports/SARIF.*');
                    sinon.assert.calledWith(logInfo, 'Finding Parasoft XML Static Analysis report in working directory D:\\github\\parasoft-findings-bitbucket\\tests...');
                    sinon.assert.calledWith(logWarn, 'Skipping unrecognized report file: D:\\github\\parasoft-findings-bitbucket\\tests\\res\\reports\\SARIF.sarif');
                    sinon.assert.notCalled(put);
                    return;
                }
                sinon.assert.fail("Expected error to be thrown but it was not.");
            }
            sinon.assert.fail("Expected error to be thrown but it was not.");
        });

        it('no Java execute file found', async () => {
            process.env.JAVA_HOME = undefined;
            const put = sandbox.fake.resolves({status: 200, data: {}});
            sandbox.replace(axios, 'put', put);
            const runOptions: RunOptions = {
                report: __dirname + '/res/reports/*.xml',
                parasoftToolOrJavaRootPath: __dirname + '/res/toolRootPath/nojava'
            };

            try {
                const staticAnalysisParserRunner = new StaticAnalysisParserRunner();
                await staticAnalysisParserRunner.run(runOptions);
            } catch (error) {
                if (error instanceof Error) {
                    sinon.assert.calledWith(logInfo, 'Finding Parasoft XML Static Analysis report...');
                    sinon.assert.calledWith(logWarn, 'Skipping unrecognized report file: D:\\github\\parasoft-findings-bitbucket\\tests\\res\\reports\\XML_COVERAGE.xml');
                    sinon.assert.calledWith(logInfo, 'Found Parasoft XML Static Analysis report: D:\\github\\parasoft-findings-bitbucket\\tests\\res\\reports\\XML_STATIC.xml');
                    sinon.assert.notCalled(put);
                    sinon.assert.match(error.message, 'Unable to process the XML report because Java or Parasoft tool installation directory is not found');
                    return;
                }
                sinon.assert.fail("Expected error to be thrown but it was not.");
            }
            sinon.assert.fail("Expected error to be thrown but it was not.");
        });

        describe('parse and upload static analysis result', () => {
            let runOptions: RunOptions;
            let joinStub: sinon.SinonStub;

            before(() => {
                const realJoin = pt.join;
                joinStub = sinon.stub(pt, 'join').callsFake((...args: string[]) => {
                    if (args.length >= 2) {
                        if (args[1] === 'SaxonHE12-2J/saxon-he-12.2.jar') {
                            return realJoin(__dirname.substring(0, __dirname.length - 'tests'.length), 'libs', ...args.slice(1));
                        }
                        if (args[1] === 'sarif.xsl') {
                            return realJoin(__dirname.substring(0, __dirname.length - 'tests'.length), 'res', ...args.slice(1));
                        }
                    }
                    return realJoin(...args);
                });
            })

            after(() => {
                joinStub.restore();
            });

            beforeEach(() => {
                if (fs.existsSync(__dirname + '/res/reports/XML_STATIC.sarif')) {
                    fs.rmSync(__dirname + '/res/reports/XML_STATIC.sarif');
                }
                runOptions = {
                    report: __dirname + '/res/reports/*.xml',
                    parasoftToolOrJavaRootPath: path.join(__dirname, '/res/toolRootPaths/toolHome')
                };
            })

            afterEach(() => {
                if (fs.existsSync(__dirname + '/res/reports/XML_STATIC.sarif')) {
                    fs.rmSync(__dirname + '/res/reports/XML_STATIC.sarif');
                }
            })

            it('parse and upload static analysis result normal', async () => {
                const put = sandbox.fake.resolves({status: 200, data: {}});
                sandbox.replace(axios, 'put', put);
                const post = sandbox.fake.resolves({status: 200, data: {}});
                sandbox.replace(axios, 'post', post);

                const staticAnalysisParserRunner = new StaticAnalysisParserRunner();
                await staticAnalysisParserRunner.run(runOptions);

                sinon.assert.calledWith(logInfo, 'Found 1552 vulnerabilities for report: D:\\github\\parasoft-findings-bitbucket\\tests\\res\\reports\\XML_STATIC.xml');
                sinon.assert.calledOnce(put);
                sinon.assert.callCount(post, 10);
                sinon.assert.calledWith(logInfo, 'Uploaded Parasoft dotTEST Static Analysis results: 1000 vulnerabilities');

            });

            it('parse report failed', async () => {
                const put = sandbox.fake.resolves({status: 200, data: {}});
                sandbox.replace(axios, 'put', put);
                const post = sandbox.fake.resolves({status: 200, data: {}});
                sandbox.replace(axios, 'post', post);

                const parseError = new Error('Failed to parse report');
                const spawn = sandbox.fake.throws(parseError);
                sandbox.replace(cp, 'spawn', spawn);

                const staticAnalysisParserRunner = new StaticAnalysisParserRunner();
                await staticAnalysisParserRunner.run(runOptions);

                sinon.assert.calledWith(logError, parseError);
                sinon.assert.calledWith(logWarn, 'Skipped Parasoft XML Static Analysis report: D:\\github\\parasoft-findings-bitbucket\\tests\\res\\reports\\XML_STATIC.xml');
                sinon.assert.notCalled(post);
                sinon.assert.notCalled(put);
            });

            it('create report module failed', async () => {
                const fakeResponse: AxiosResponse = {
                    status: 500,
                    statusText: 'Internal Server Error',
                    headers: {},
                    config: {
                        headers: new AxiosHeaders('headers')
                    },
                    data: {message: 'Something went wrong'}
                };
                const error = new AxiosError("Failed to create report module", undefined, undefined, undefined, fakeResponse);
                const put = sandbox.fake.rejects(error)
                sandbox.replace(axios, 'put', put);
                const post = sandbox.fake.resolves({status: 200, data: {}});
                sandbox.replace(axios, 'post', post);
                try {
                    const staticAnalysisParserRunner = new StaticAnalysisParserRunner();
                    await staticAnalysisParserRunner.run(runOptions);
                } catch (error) {
                    if (error instanceof Error) {
                        sinon.assert.calledWith(logError, "{\n  \"message\": \"Something went wrong\"\n}");
                        sinon.assert.calledOnce(put);
                        sinon.assert.notCalled(post);
                        sinon.assert.match(error.message, 'Failed to create report module');
                        return;
                    }

                }
                sinon.assert.fail("Expected error to be thrown but it was not.");
            });

            it('upload static analysis result failed', async () => {
                const fakeResponse: AxiosResponse = {
                    status: 500,
                    statusText: 'Internal Server Error',
                    headers: {},
                    config: {
                        headers: new AxiosHeaders('headers')
                    },
                    data: {message: 'Something went wrong'}
                };
                const error = new AxiosError("Failed to upload static Analysis results", undefined, undefined, undefined, fakeResponse);
                const put = sandbox.fake.resolves({status: 200, data: {}});
                sandbox.replace(axios, 'put', put);
                const post = sandbox.fake.rejects(error);
                sandbox.replace(axios, 'post', post);
                try {
                    const staticAnalysisParserRunner = new StaticAnalysisParserRunner();
                    await staticAnalysisParserRunner.run(runOptions);
                } catch (error) {
                    if (error instanceof Error) {
                        sinon.assert.calledWith(logError, "{\n  \"message\": \"Something went wrong\"\n}");
                        sinon.assert.calledOnce(put);
                        sinon.assert.calledOnce(post);
                        sinon.assert.match(error.message, 'Failed to upload Parasoft dotTEST Static Analysis results. Error: AxiosError: Failed to upload static Analysis results');
                        return;
                    }

                }
                sinon.assert.fail("Expected error to be thrown but it was not.");
            });
        });

        const setBitbucketEnv = (
            userMail?: string,
            apiToken?: string,
            repoSlug?: string,
            commit?: string,
            workspace?: string,
            cloneDir?: string,
            apiUrl?: string
        ) => {
            process.env.USER_EMAIL = userMail === undefined ? 'user@mail.com' : userMail;
            process.env.API_TOKEN = apiToken === undefined ? 'api-token' : apiToken;
            process.env.BITBUCKET_REPO_SLUG = repoSlug === undefined ? 'repo' : repoSlug;
            process.env.BITBUCKET_COMMIT = commit === undefined ? 'commit' : commit;
            process.env.BITBUCKET_WORKSPACE = workspace === undefined ? 'workspace' : workspace;
            process.env.BITBUCKET_CLONE_DIR = cloneDir === undefined ? __dirname : cloneDir;
            process.env.BITBUCKET_API_URL = apiUrl == undefined ? 'https://api.bitbucket.org/2.0/repositories' : apiUrl;
        };
    });
})