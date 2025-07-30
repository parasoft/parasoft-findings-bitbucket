// scripts/fix-bom.js
const fs = require('fs');
const process = require('process');

// Read JSON file
function readJSONFile(filePath) {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(fileContent);
}

// Get file paths from command-line arguments
const sbomFilePath = process.argv[2];
const licenseMappingFilePath = process.argv[3];
const injectionMappingFilePath = process.argv[4];

// Load the SBOM and license mapping JSON files
const sbom = readJSONFile(sbomFilePath);
const licenseMapping = readJSONFile(licenseMappingFilePath);
const injectionMapping = readJSONFile(injectionMappingFilePath);

// Function to update licenses in SBOM based on the license mapping
function update(sbom, licenseMap, injectionMap) {
    sbom.components.forEach(component => {
        if (!component.licenses || !component.licenses[0]?.license?.id || !component.licenses[0]?.license?.url) {
            const mapping = licenseMap.find(m => m.purl === component.purl);
            if (mapping) {
                component.licenses = mapping.licenses;
            } else {
                console.log(`Missing "Licenses" information for component ${component.purl}`);
            }
        }
        
        if (!component.externalReferences) {
            console.log(`"externalReferences" for component ${component.purl} is missing.`);
            component.externalReferences = [];
        }
        
        const licenseRef = component.externalReferences.find(ref => ref.type === 'license');
        if (!licenseRef && component.licenses[0]?.license?.url) {
            component.externalReferences.push({ 
                type: 'license', 
                url: component.licenses[0].license.url 
            });
        }
        
        const otherRef = component.externalReferences.find(ref => ref.type === 'other');
        if (!otherRef) {
            const mapping = injectionMap.find(m => m.purl === component.purl);
            if (mapping) {
                const other = mapping.externalReferences.find(ref => ref.type === 'other');
                if (other) {
                    component.externalReferences.push({ 
                        type: 'other', 
                        url: other.url 
                    });
                    return;
                }
            }
            console.log(`Missing "other" information in "externalReferences" for component ${component.purl}`);
        }
    });
    return sbom;
}

// Update the SBOM licenses
const updatedSbom = update(sbom, licenseMapping, injectionMapping);

// Save the updated SBOM back to the original file
fs.writeFileSync(sbomFilePath, JSON.stringify(updatedSbom, null, 2), 'utf8');
console.log('SBOM licenses updated based on license-mapping.json and injection-mapping.json.');