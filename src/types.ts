export type ReportContents = {
    runs: ReportContent[];
}

type ReportContent = {
    tool: {
        driver: {
            name: string;
            rules: Rule[];
        };
    };
    results: ReportResult[];
}

export type Rule = {
    id: string;
    fullDescription?: { text: string };
    shortDescription?: { text: string };
}

export type ReportResult = {
    ruleId: string;
    level: 'note' | 'warning' | 'error' | 'critical';
    message: { text: string };
    locations: VulnerabilityLocation[]
}

type VulnerabilityLocation = {
    physicalLocation: {
        artifactLocation: { uri: string };
        region: {
            startLine: number;
            endLine?: number;
        };
    };
}

export type VulnerabilityDetail = {
    annotation_type: string;
    severity: string;
    path: string;
    line: number;
    summary?: string;
    details: string;
}