import * as cp from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as pt from 'path';
import * as glob from 'glob';
import * as sax from 'sax';
import * as sarifReportTypes from './sarifReportTypes';
import * as uuid from 'uuid'
import axios, {AxiosBasicCredentials} from "axios";
import {logger} from './logger';
import {messages, messagesFormatter} from './messages';

export interface RunOptions {
    /* Specify a path or minimatch pattern to locate Parasoft static analysis report files */
    report: string;

    /* Specify a path to Parasoft tool installation folder or Java installation folder */
    parasoftToolOrJavaRootPath?: string;
}

interface ReportVulnerability {
    toolName: string;
    vulnerabilityDetail: sarifReportTypes.VulnerabilityDetail[];
}

export class StaticAnalysisParserRunner {
    BITBUCKET_ENVS: sarifReportTypes.BitbucketEnv;
    WORKING_DIRECTORY = process.env.BITBUCKET_CLONE_DIR || '.';
    PARASOFT_SEV_LEVEL_MAP = {
        '1': 'CRITICAL',
        '2': 'HIGH',
        '3': 'MEDIUM',
        '4': 'MEDIUM',
        '5': 'LOW'
    };

    vulnerabilityMap: Map<string, ReportVulnerability>;

    constructor() {
        this.BITBUCKET_ENVS = this.getBitbucketEnvs();
        this.vulnerabilityMap = new Map<string, ReportVulnerability>();
    }

    async run(runOptions: RunOptions) : Promise<void> {
        const parasoftReportPaths = await this.findParasoftStaticAnalysisReports(runOptions.report);
        const javaFilePath = this.getJavaFilePath(runOptions.parasoftToolOrJavaRootPath);

        for (const parasoftReportPath of parasoftReportPaths) {
            logger.info(messagesFormatter.format(messages.parsing_parasoft_report, parasoftReportPath));

            try {
                const sarifReport = await this.convertReportWithJava(javaFilePath, parasoftReportPath);
                await this.parseSarifReport(sarifReport, parasoftReportPath);
            } catch (error) {
                if (error instanceof Error) {
                    logger.error(error);
                }
                logger.warn(messagesFormatter.format(messages.skip_static_analysis_report, parasoftReportPath));
            }
        }

        await this.uploadVulnerabilitiesToBitbucket();
    }

    private async findParasoftStaticAnalysisReports(reportPath: string): Promise<string[]> {
        if (pt.isAbsolute(reportPath)) {
            logger.info(messages.finding_static_analysis_report);
            // On Windows, if the path starts with '/', path.resolve() will prepend the current drive letter
            // Example: '/report.xml' -> 'C:/report.xml'
            reportPath = pt.resolve(reportPath);
        } else {
            logger.info(messagesFormatter.format(messages.finding_static_analysis_report_in_working_directory, this.WORKING_DIRECTORY));
            reportPath = pt.join(this.WORKING_DIRECTORY, reportPath);
        }

        reportPath = reportPath.replace(/\\/g, '/');

        // Use glob to find the matching report paths
        const reportPaths: string[] = glob.sync(reportPath);

        const staticReportPaths: string[] = [];
        for (const reportPath of reportPaths) {
            if (!reportPath.toLocaleLowerCase().endsWith('.xml')) {
                logger.warn(messagesFormatter.format(messages.skipping_unrecognized_report_file, reportPath));
                continue;
            }

            const isStaticReport = await this.isStaticReport(reportPath);
            if (!isStaticReport) {
                logger.warn(messagesFormatter.format(messages.skipping_unrecognized_report_file, reportPath));
                continue;
            }
            logger.info(messagesFormatter.format(messages.found_matching_file, reportPath));
            staticReportPaths.push(reportPath);
        }

         if (!staticReportPaths || staticReportPaths.length == 0) {
            throw new Error(messagesFormatter.format(messages.static_analysis_report_not_found, reportPath));
        }

        return staticReportPaths;
    }

    private async convertReportWithJava(javaPath: string, sourcePath: string): Promise<string> {
        logger.debug(messagesFormatter.format(messages.converting_static_analysis_report_to_sarif, sourcePath));

        const jarPath = pt.join(__dirname, 'SaxonHE12-2J/saxon-he-12.2.jar');
        const xslPath = pt.join(__dirname, 'sarif.xsl');
        const workspace = pt.normalize(this.WORKING_DIRECTORY).replace(/\\/g, '/');
        const outPath = sourcePath.substring(0, sourcePath.toLocaleLowerCase().lastIndexOf('.xml')) + '.sarif';

        const commandLine = `"${javaPath}" -jar "${jarPath}" -s:"${sourcePath}" -xsl:"${xslPath}" -o:"${outPath}" -versionmsg:off projectRootPaths="${workspace}"`;
        logger.debug(commandLine);
        const exitCode = await new Promise<number>((resolve, reject) => {
            const process = cp.spawn(`${commandLine}`, { shell: true, windowsHide: true });
            this.handleProcess(process, resolve, reject);
        });

        if (exitCode != 0) {
            throw new Error(messagesFormatter.format(messages.failed_parse_report, sourcePath));
        }

        logger.debug(messagesFormatter.format(messages.converted_sarif_report, outPath));
        return outPath;
    }

    private handleProcess(process: any, resolve: any, reject: any) {
        process.stdout?.on('data', (data: any) => { logger.info(`${data}`.replace(/\s+$/g, '')); });
        process.stderr?.on('data', (data: any) => { logger.info(`${data}`.replace(/\s+$/g, '')); });
        process.on('close', (code: any) => {
            const exitCode = (code != null) ? code : 150 // 150 = signal received
            resolve(exitCode);
        });
        process.on('error', (err: any) => { reject(err); });
    }

    private async isStaticReport(reportPath: string): Promise<boolean> {
        return new Promise((resolve) => {
            let isStaticReport = false;
            const saxStream = sax.createStream(true, {});
            saxStream.on('opentag', (node: { name: string; }) => {
                if (!isStaticReport && node.name == 'StdViols') {
                    isStaticReport = true;
                }
            });
            saxStream.on('error',(e) => {
                logger.warn(messagesFormatter.format(messages.failed_to_parse_static_analysis_report, reportPath, e.message));
                resolve(false);
            });
            saxStream.on('end', () => {
                resolve(isStaticReport);
            });
            fs.createReadStream(reportPath).pipe(saxStream);
        });
    }

    private getJavaFilePath(parasoftToolOrJavaRootPath: string | undefined): string {
        const javaInstallDir = parasoftToolOrJavaRootPath || process.env.JAVA_HOME;

        if (!javaInstallDir || !fs.existsSync(javaInstallDir)) {
            throw new Error(messagesFormatter.format(messages.java_or_parasoft_tool_install_dir_not_found));
        }

        const javaFilePath = this.doGetJavaFilePath(javaInstallDir);
        if (!javaFilePath) {
            throw new Error(messagesFormatter.format(messages.java_not_found_in_java_or_parasoft_tool_install_dir));
        } else {
            logger.debug(messagesFormatter.format(messages.found_java_at, javaFilePath));
        }

        return javaFilePath;
    }

    private doGetJavaFilePath(installDir: string): string | undefined {
        logger.debug(messagesFormatter.format(messages.finding_java_in_java_or_parasoft_tool_install_dir, installDir));
        const javaFileName = os.platform() == 'win32' ? 'java.exe' : 'java';
        const javaPaths = [
            'bin', // Java installation
            'bin/dottest/Jre_x64/bin', // dotTEST installation
            'bin/jre/bin' // C/C++test or Jtest installation
        ];

        for (const path of javaPaths) {
            const javaFilePath = pt.join(installDir, path, javaFileName);
            if (fs.existsSync(javaFilePath)) {
                return javaFilePath;
            }
        }

        return undefined;
    }

    private async parseSarifReport(sarifReportPath: string, parasoftReportPath: string): Promise<void> {
        const reportContents = await this.readSarifReport(sarifReportPath);
        const { tool, results } = reportContents.runs[0];
        const rules = this.getRules(reportContents);

        const vulnerabilities = results.map(result => {
            const rule = rules[result.ruleId];
            return {
                external_id: this.getUnbViolId(result),
                annotation_type: 'VULNERABILITY',
                severity: this.getSeverityLevel(rule),
                path: this.getPath(result),
                line: this.getLine(result),
                summary: this.getSummary(rule),
                details: result.message.text
            };
        });

        this.vulnerabilityMap.set(parasoftReportPath, {toolName: tool.driver.name, vulnerabilityDetail: vulnerabilities});

        logger.info(messagesFormatter.format(messages.parsed_parasoft_static_analysis_report, parasoftReportPath, vulnerabilities.length));
    }

    private async readSarifReport(reportPath: string): Promise<sarifReportTypes.ReportContents> {
        const reportContent = await fs.promises.readFile(reportPath, 'utf8');
        return JSON.parse(reportContent);
    }

    private getRules(reportContents: sarifReportTypes.ReportContents) {
        const rules = reportContents.runs[0].tool.driver.rules;
        const map: Record<string, typeof rules[0]> = {};
        rules.forEach(rule => map[rule.id] = rule);
        return map;
    }

    private getPath(result: sarifReportTypes.ReportResult): string {
        return result.locations[0].physicalLocation.artifactLocation.uri;
    }

    private getLine(result: sarifReportTypes.ReportResult): number {
        const { region } = result.locations[0].physicalLocation;
        return region.startLine ?? region.endLine;
    }

    private getSummary(rule: sarifReportTypes.Rule): string {
        return rule.fullDescription?.text ?? rule.shortDescription?.text ?? '';
    }

    private getSeverityLevel(rule: sarifReportTypes.Rule): string {
        return this.PARASOFT_SEV_LEVEL_MAP[rule.properties.parasoftSevLevel];
    }

    private getUnbViolId(result: sarifReportTypes.ReportResult): string {
        const unbViolId = result.partialFingerprints.unbViolId;
        if (unbViolId) {
            return unbViolId;
        }

        const namespace = '6af5b03d-5276-49ef-bfed-d445f2752b02';
        const violType = result.partialFingerprints?.violType || '';
        const ruleId = result.ruleId || '';
        const msg = result.message?.text || '';
        const severity = result.level || '';
        const lineHash = result.partialFingerprints?.lineHash || '';
        const uri = result.locations?.[0]?.physicalLocation?.artifactLocation?.uri || '';

        return uuid.v5(violType + ruleId + msg + severity + lineHash + uri, namespace);
    }

    private async uploadVulnerabilitiesToBitbucket(): Promise<void> {
        for (const [parasoftReportPath, vulnerability] of this.vulnerabilityMap) {
            const toolName = vulnerability.toolName;
            let vulnerabilities = this.sortVulnerabilitiesBySevLevel(vulnerability.vulnerabilityDetail);
            const reportId = uuid.v5(parasoftReportPath + this.BITBUCKET_ENVS.COMMIT, '6ba7b811-9dad-11d1-80b4-00c04fd430c8');

            logger.info(messagesFormatter.format(messages.uploading_parasoft_report_results, toolName));

            let reportDetails = messagesFormatter.format(messages.report_contains_vulnerabilities, vulnerabilities.length);
            if (vulnerabilities && vulnerabilities.length > 100) {
                vulnerabilities = vulnerabilities.slice(0, 100);
                reportDetails = messagesFormatter.format(messages.report_shows_vulnerabilities, reportDetails);
            }

            const hasHighOrCritical = vulnerabilities.some(v => ["CRITICAL", "HIGH"].includes(v.severity));

            // Create report module
            await axios.put(this.getReportUrl(reportId), {
                title: `Parasoft ${toolName}`,
                details: reportDetails,
                report_type: "SECURITY",
                reporter: "parasoft",
                result: hasHighOrCritical ? "FAILED" : "PASSED"
            }, { auth: this.getAuth() });

            // Upload annotations (vulnerabilities)
            const uploadResponse = await axios.post(
                `${this.getReportUrl(reportId)}/annotations`,
                vulnerabilities,
                { auth: this.getAuth() }
            );

            if (uploadResponse.status != 200) {
                throw new Error(messagesFormatter.format(messages.failed_to_upload_parasoft_report_results, toolName, uploadResponse.statusText));
            }

            logger.info(messagesFormatter.format(messages.uploaded_parasoft_report_results, toolName));
        }
    }

    private getReportUrl(reportId: string): string {
        const BB_API_URL = 'https://api.bitbucket.org/2.0/repositories'
        const { WORKSPACE, REPO, COMMIT } = this.BITBUCKET_ENVS;
        return `${BB_API_URL}/${WORKSPACE}/${REPO}/commit/${COMMIT}/reports/${reportId}`;
    }

    private getAuth(): AxiosBasicCredentials {
        const { BB_USER, BB_APP_PASSWORD } = this.BITBUCKET_ENVS;
        return { username: BB_USER, password: BB_APP_PASSWORD };
    }

    getBitbucketEnvs(): sarifReportTypes.BitbucketEnv {
        const requiredEnvs: { [key: string]: string | undefined } = {
            BB_USER: process.env.BB_USER,
            BB_APP_PASSWORD: process.env.BB_APP_PASSWORD,
            REPO: process.env.BITBUCKET_REPO_SLUG,
            COMMIT: process.env.BITBUCKET_COMMIT,
            WORKSPACE: process.env.BITBUCKET_WORKSPACE
        }

        const missingEnvs = Object.keys(requiredEnvs).filter(key => requiredEnvs[key] == undefined);
        if (missingEnvs.length > 0) {
            throw new Error(messagesFormatter.format(messages.missing_required_environment_variables, missingEnvs.join(', ')));
        }

        return requiredEnvs as sarifReportTypes.BitbucketEnv;
    }

    private sortVulnerabilitiesBySevLevel(vulnerabilities: sarifReportTypes.VulnerabilityDetail[]): sarifReportTypes.VulnerabilityDetail[] {
        const severityOrder: { [key: string]: number } = {
            LOW: 1,
            MEDIUM: 2,
            HIGH: 3,
            CRITICAL: 4
        };

        return [...vulnerabilities].sort((currentVuln, nextVuln) => {
            return severityOrder[nextVuln.severity] - severityOrder[currentVuln.severity];
        });
    }
}