export type SarifReportContents = {
    runs: SarifReportContent[];
}

type SarifReportContent = {
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
    properties: {
        "parasoftSevLevel": '1' | '2' | '3' | '4' | '5';
    }
}

export type ReportResult = {
    ruleId: string;
    level: 'note' | 'warning' | 'error' | 'none';
    message: { text: string };
    partialFingerprints: PartialFingerprints;
    locations: VulnerabilityLocation[];
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

type PartialFingerprints = {
    violType: string;
    lineHash: string;
    unbViolId: string;
}

export type VulnerabilityDetail = {
    external_id: string;
    annotation_type: string;
    severity: string;
    path: string;
    line: number;
    summary?: string;
    details: string;
}