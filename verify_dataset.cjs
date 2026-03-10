const fs = require('fs');

const missingIds = [
  117,133,138,142,146,155,208,211,235,271,285,295,297,355,372,430,449,460,652,703,715,716,731,911,981,1244,2013
];

function verify() {
  const filePath = '/Users/czarflix/Downloads/DSA/dsa-app/src/final_dataset.json';
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`Invalid JSON in file: ${err.message}`);
    return;
  }

  if (!Array.isArray(data)) {
    console.error("Dataset should be a JSON array.");
    return;
  }

  console.log(`Total items found: ${data.length}`);

  const foundIds = new Set();
  const errors = [];
  const requiredFields = ['question_id', 'problem_description', 'starter_code', 'test'];

  data.forEach((item, index) => {
    const id = item.question_id || item.leetcode_id; 
    if (!id) {
      errors.push(`Row ${index}: Missing a recognizable ID (question_id or leetcode_id).`);
    } else {
      foundIds.add(id);
    }

    const missingFields = requiredFields.filter(f => !item[f] && item[f] !== "");
    if (missingFields.length > 0) {
      errors.push(`Row ${index} (ID: ${id}): Missing fields: ${missingFields.join(', ')}`);
    }

    // Verify input_output if present is valid JSON string or an object
    if (item.input_output) {
      if (typeof item.input_output === 'string') {
        try {
          JSON.parse(item.input_output);
        } catch (e) {
          errors.push(`Row ${index} (ID: ${id}): input_output is an invalid JSON string.`);
        }
      }
    }
  });

  const missingExpected = missingIds.filter(id => !foundIds.has(id));
  const unexpected = [...foundIds].filter(id => !missingIds.includes(id));

  console.log(`\n--- Verification Results ---`);
  if (missingExpected.length > 0) {
    console.error(`❌ Missing expected IDs: ${missingExpected.join(', ')}`);
  } else {
    console.log(`✅ All ${missingIds.length} expected IDs are present.`);
  }

  if (unexpected.length > 0) {
    console.error(`❌ Found unexpected IDs: ${unexpected.join(', ')}`);
  }

  if (errors.length > 0) {
    console.error(`\n❌ Found ${errors.length} formatting errors:`);
    errors.slice(0, 20).forEach(e => console.error(`  - ${e}`));
    if (errors.length > 20) console.error(`  ... and ${errors.length - 20} more.`);
  } else if (missingExpected.length === 0 && unexpected.length === 0) {
    console.log(`\n🌟 PERFECT MATCH! The dataset is correctly formatted and contains all 27 required problems with all mandatory fields.`);
  }
}

verify();
