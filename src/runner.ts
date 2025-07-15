import * as cp from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as pt from 'path';
import * as glob from 'glob';
import * as sax from 'sax';
import * as types from './types';
import * as uuid from 'uuid'
import {logger} from './logger';
import {messages, messagesFormatter} from './messages';

export interface RunOptions {
    /* Specify a path or minimatch pattern to locate Parasoft static analysis report files */
    report: string;

    /* Specify a path to Parasoft tool installation folder or Java installation folder */
    parasoftToolOrJavaRootPath?: string;
}

interface ConversionResultDetails {
    exitCode: number;
    convertedReportPath?: string;
}

export interface Result {
    exitCode: number
}

export class StaticAnalysisParserRunner {
    WORKING_DIRECTORY = process.env.BITBUCKET_CLONE_DIR + '';
    vulnerabilityMap = new Map<string, types.VulnerabilityDetail[]>();
    toolNameList = new Array<string>();

    async run(runOptions: RunOptions) : Promise<Result> {
        const parasoftReportPaths = await this.findParasoftStaticAnalysisReports(runOptions.report);
        if (!parasoftReportPaths || parasoftReportPaths.length == 0) {
            logger.warn(messagesFormatter.format(messages.static_analysis_report_not_found, runOptions.report));
            return { exitCode: -1 };
        }

        const javaFilePath = this.getJavaFilePath(runOptions.parasoftToolOrJavaRootPath);
        if (!javaFilePath) {
            return { exitCode: -1 }
        }

        let convertReportResult: ConversionResultDetails = {exitCode: 1};
        for (const parasoftReportPath of parasoftReportPaths) {
            logger.info(messagesFormatter.format(messages.parsing_parasoft_report, parasoftReportPath));
            convertReportResult = await this.convertReportWithJava(javaFilePath, parasoftReportPath);

            if (convertReportResult.exitCode == 0 && convertReportResult.convertedReportPath) {
                await this.parseSarifReport(convertReportResult.convertedReportPath);
                // TODO: Implement uploading violation results to Bitbucket report module
            }
        }

        return { exitCode: convertReportResult.exitCode };
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
        return staticReportPaths;
    }

    private async convertReportWithJava(javaPath: string, sourcePath: string): Promise<ConversionResultDetails> {
        logger.debug(messagesFormatter.format(messages.converting_static_analysis_report_to_sarif, sourcePath));
        const jarPath = pt.join(__dirname, 'SaxonHE12-2J/saxon-he-12.2.jar');
        const xslPath = pt.join(__dirname, 'sarif.xsl');
        const workspace = pt.normalize(this.WORKING_DIRECTORY).replace(/\\/g, '/');
        const outPath = sourcePath.substring(0, sourcePath.toLocaleLowerCase().lastIndexOf('.xml')) + '.sarif';

        const commandLine = `"${javaPath}" -jar "${jarPath}" -s:"${sourcePath}" -xsl:"${xslPath}" -o:"${outPath}" -versionmsg:off projectRootPaths="${workspace}"`;
        logger.debug(commandLine);
        const result = await new Promise<ConversionResultDetails>((resolve, reject) => {
            const process = cp.spawn(`${commandLine}`, {shell: true, windowsHide: true });
            this.handleProcess(process, resolve, reject);
        });

        if (result.exitCode != 0) {
            return { exitCode: result.exitCode };
        }

        logger.debug(messagesFormatter.format(messages.converted_sarif_report, outPath));
        return { exitCode: 0, convertedReportPath: outPath };
    }

    private handleProcess(process: any, resolve: any, reject: any) {
        process.stdout?.on('data', (data: any) => { logger.info(`${data}`.replace(/\s+$/g, '')); });
        process.stderr?.on('data', (data: any) => { logger.info(`${data}`.replace(/\s+$/g, '')); });
        process.on('close', (code: any) => {
            const result : ConversionResultDetails = {
                exitCode: (code != null) ? code : 150 // 150 = signal received
            };
            resolve(result);
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
                logger.warn(messagesFormatter.format(messages.failed_to_parse_static_analysis_report, reportPath, e.message))
                resolve(false);
            });
            saxStream.on('end', () => {
                resolve(isStaticReport);
            });
            fs.createReadStream(reportPath).pipe(saxStream);
        });
    }

    private getJavaFilePath(parasoftToolOrJavaRootPath: string | undefined): string | undefined {
        const javaInstallDir = parasoftToolOrJavaRootPath || process.env.JAVA_HOME;

        if (!javaInstallDir || !fs.existsSync(javaInstallDir)) {
            logger.warn(messages.java_or_parasoft_tool_install_dir_not_found);
            return undefined;
        }

        const javaFilePath = this.doGetJavaFilePath(javaInstallDir);
        if (!javaFilePath) {
            logger.warn(messagesFormatter.format(messages.java_not_found_in_java_or_parasoft_tool_install_dir));
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

    private async parseSarifReport(sarifReportPath: string): Promise<void> {
        logger.debug(messagesFormatter.format(messages.parsing_sarif_report, sarifReportPath));

        const reportContents = await this.readSarifReport(sarifReportPath);
        const { tool, results } = reportContents.runs[0];

        const vulnerabilities = results.map(result =>
            this.getVulnerability(result, this.getRules(reportContents))
        );

        this.setVulnerabilities(tool.driver.name, vulnerabilities);
        logger.debug(messagesFormatter.format(messages.parsed_sarif_report, sarifReportPath, vulnerabilities.length));
    }

    private async readSarifReport(reportPath: string): Promise<types.SarifReportContents> {
        const reportContent = await fs.promises.readFile(reportPath, 'utf8');
        return JSON.parse(reportContent);
    }

    private getVulnerability(result: types.ReportResult, rules: Record<string, types.Rule>): types.VulnerabilityDetail {
        const rule = rules[result.ruleId];
        return {
            external_id: result.partialFingerprints.unbViolId ?? this.generateUnbViolId(result),
            annotation_type: 'VULNERABILITY',
            severity: this.getSeverityLevel(result, rule),
            path: this.getPath(result),
            line: this.getLine(result),
            summary: this.getSummary(rule),
            details: result.message.text
        };
    }

    private setVulnerabilities(toolName: string, vulnerabilities: types.VulnerabilityDetail[]) {
        const existing = this.vulnerabilityMap.get(toolName) ?? [];
        this.vulnerabilityMap.set(toolName, this.mergeReportVulnerabilities(existing, vulnerabilities));

        if (!this.toolNameList.includes(toolName)) {
            this.toolNameList.push(toolName);
        }
    }

    private getRules(reportContents: types.SarifReportContents) {
        const rules = reportContents.runs[0].tool.driver.rules;
        const map: Record<string, typeof rules[0]> = {};
        rules.forEach(rule => map[rule.id] = rule);
        return map;
    }

    private getPath(result: types.ReportResult): string {
        return result.locations[0].physicalLocation.artifactLocation.uri;
    }

    private getLine(result: types.ReportResult): number {
        const { region } = result.locations[0].physicalLocation;
        return region.endLine ?? region.startLine;
    }

    private getSummary(rule: types.Rule): string {
        return rule.fullDescription?.text ?? rule.shortDescription?.text ?? '';
    }

    private getSeverityLevel(result: types.ReportResult, rule: types.Rule): string {
        const SEVERITY_MAP = {
            'error': 'HIGH',
            'warning': 'MEDIUM',
            'note': 'LOW',
            'none': 'NONE'
        };

        const SECURITY_SEVERITY_MAP = {
            '9.5': 'CRITICAL',
            '8': 'HIGH',
            '6': 'MEDIUM',
            '4': 'MEDIUM',
            '2': 'LOW',
            '0': 'NONE'
        };

        const severityLevel = SEVERITY_MAP[result.level];
        if (rule.properties['security-severity']) {
            return SECURITY_SEVERITY_MAP[rule.properties['security-severity']];
        }

        return severityLevel;
    }

    private mergeReportVulnerabilities(currentVulnerabilities: types.VulnerabilityDetail[], newVulnerabilities: types.VulnerabilityDetail[]): types.VulnerabilityDetail[] {
        const map = new Map<string, types.VulnerabilityDetail>();
        [...currentVulnerabilities, ...newVulnerabilities].forEach(vulnerability => map.set(vulnerability.external_id, vulnerability));
        return Array.from(map.values());
    }

    private generateUnbViolId(result: types.ReportResult): string {
        const namespace = '6af5b03d-5276-49ef-bfed-d445f2752b02';
        const violType = result.partialFingerprints?.violType || '';
        const ruleId = result.ruleId || '';
        const msg = result.message?.text || '';
        const severity = result.level || '';
        const lineHash = result.partialFingerprints?.lineHash || '';
        const uri = result.locations?.[0]?.physicalLocation?.artifactLocation?.uri || '';

        return uuid.v5(violType + ruleId + msg + severity + lineHash + uri, namespace);
    }
}