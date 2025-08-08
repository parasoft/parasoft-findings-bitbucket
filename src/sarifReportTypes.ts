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
    properties: {
        "parasoftSevLevel": '1' | '2' | '3' | '4' | '5';
    }
}

export type ReportResult = {
    ruleId: string;
    level: 'note' | 'warning' | 'error' | 'none';
    message: {
        text: string;
        markdown?: string;
    };
    partialFingerprints: PartialFingerprints;
    locations: VulnerabilityLocation[];
    suppressions: object[];
    codeFlows?: ThreadFlows[];
}

type VulnerabilityLocation = {
    physicalLocation: {
        artifactLocation: { uri: string };
        region: {
            startLine: number;
            endLine?: number;
        };
    };
    message?: {
        text: string;
    };
}

type ThreadFlows = {
    locations: Location[];
}

type Location = {
    location: VulnerabilityLocation;
    nestingLevel: number;
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
    details: string | Promise<string>;
}