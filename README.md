# Parasoft Findings Bitbucket
A CLI tool that parses Parasoft static analysis reports (XML) and uploads the results to Bitbucket, with support for quality gate check.

- [Quick start](#quick-start)
- [Example Pipelines](#example-pipelines)
- [Known Limitations in Bitbucket](#known-limitations)

## <a name="quick-start"></a> Quick Start
To display Parasoft static analysis results on Bitbucket, you need to customize your Bitbucket pipeline to:
  1. Generate a Parasoft static analysis XML report.
  2. Use this tool to upload the report results to Bitbucket.

### Prerequisites
- Node.js 18+

- Java 17+

- Generated Parasoft static analysis XML report

### Bitbucket Configuration
- Create repository variables **USER_EMAIL** and **API_TOKEN** used for Bitbucket API access.

- Install the Parasoft Findings Bitbucket CLI globally:
    ```yaml
    npm i -g github:parasoft/parasoft-findings-bitbucket
    ```

### Adding the Parasoft Findings Bitbucket tool to Bitbucket Pipeline
```yaml
name: "Parasoft Findings Bitbucket"
script:
  # Use parasoft-findings-bitbucket to upload Parasoft static analysis XML report results to Bitbucket
  - parasoft-findings-bitbucket --report "</path/to/report.xml>" --parasoftToolOrJavaRootPath "<path/to/parasoftTool>" --debug
```

### Command Line Options

| Parameter                    | Description                                                                                                                                                                                                                                                                             |
|------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| --report                     | *Required.* Path or minimatch pattern to locate Parasoft static analysis report files. If using a relative path, it is relative to the Bitbucket clone directory.                                                                                                                       |
| --parasoftToolOrJavaRootPath | Root path to the Parasoft tool or Java installation required to locate the Java environment for report processing. If not specified, the tool will attempt to use the path from the JAVA_HOME environment variable.                                                                     |
| --qualityGate                | Specify one or more quality gates for the Bitbucket build. Each value must be in the format: 'BITBUCKET_SECURITY_LEVEL=THRESHOLD' (e.g., CRITICAL=1). Available security levels (case-insensitive): ALL, CRITICAL, HIGH, MEDIUM, LOW. To set multiple gates, use the option repeatedly. |
| --debug                      | Enable to show debug log messages.                                                                                                                                                                                                                                                      |
| --version                    | Print version number and exit.                                                                                                                                                                                                                                                          |
| --help                       | Print help information and exit.                                                                                                                                                                                                                                                        |

## <a name="example-pipelines"></a> Example Pipelines
Here is a basic Bitbucket pipeline example to help you get started with the parasoft-findings-bitbucket tool:

### Upload Parasoft static analysis XML report results
```yaml
pipelines:
  default:
      - step:
          runs-on:
            - self.hosted
            - windows
          name: "Upload Parasoft static analysis XML report results via Parasoft Findings Bitbucket"
          script:
            # Install Parasoft Findings Bitbucket tool
            - npm i -g github:parasoft/parasoft-findings-bitbucket

            # Generate Parasoft Static Analysis XML and HTML reports. The HTML report provides detailed information on Flow and Code Duplicate vulnerabilities
            - jtestcli.exe -config "builtin://Recommended Rules" -settings "localsettings.properties" -data "demo.data.json" -report "reports/static/report.xml" -property report.format=xml,html

            # Use parasoft-findings-bitbucket to upload Parasoft static analysis XML report results to Bitbucket
            - parasoft-findings-bitbucket --report "reports/static/report.xml" --parasoftToolOrJavaRootPath "C:/Java/jdk-17" --debug

          artifacts:
            # Upload the HTML report to artifacts
            - reports/static/report.html
```

### Upload Parasoft static analysis XML report results, including quality gate checks
```yaml
pipelines:
  default:
      - step:
          runs-on:
            - self.hosted
            - windows
          name: "Upload Parasoft static analysis XML report results including quality gate checks via Parasoft Findings Bitbucket"
          script:
            # Install Parasoft Findings Bitbucket tool
            - npm i -g github:parasoft/parasoft-findings-bitbucket

            # Generate Parasoft Static Analysis XML and HTML reports. The HTML report provides detailed information on Flow and Code Duplicate vulnerabilities
            - jtestcli.exe -config "builtin://Recommended Rules" -settings "localsettings.properties" -data "demo.data.json" -report "reports/static/report.xml" -property report.format=xml,html

            # Use parasoft-findings-bitbucket to upload Parasoft static analysis XML report results to Bitbucket, and check quality gates
            - parasoft-findings-bitbucket --report "reports/static/report.xml" --parasoftToolOrJavaRootPath "C:/Java/jdk-17" --qualityGate "ALL=5" --qualityGate "CRITICAL=1" --debug

          artifacts:
            # Upload the HTML report to artifacts
            - reports/static/report.html
```

## <a name="known-limitations"></a> Known Limitations in Bitbucket
- For Flow and Code Duplicate vulnerabilities, the Bitbucket report can only display plain text (no formatting). As a result, only a brief summary is shown. For full details, please refer to the HTML report generated by the Parasoft tool.
- Each report can display a maximum of 1,000 vulnerabilities.
- The description for each vulnerability is limited to 2,000 characters.