# Measurement Precision & Unit Conversion Logic

## Problem Solved

**Before**: If requirement said "20 cm" and vendor said "20 inches", system treated them as equal (WRONG: 20 cm ≈ 7.87 inches)

**After**: System now:
1. ✅ Extracts units explicitly from both requirements and vendor quotes
2. ✅ Normalizes all measurements to SI units (meters, kg, watts, °C)
3. ✅ Compares with unit awareness
4. ✅ Flags unit mismatches as CRITICAL issues
5. ✅ Flags value differences >5% as precision errors

---

## How It Works

### Stage 1: Unit Extraction
**Groq Stage 2** extracts measurements with explicit units:
```json
{
  "measurements": [
    {"description": "diameter", "value": 20, "unit": "cm", "type": "length"},
    {"description": "weight", "value": 100, "unit": "lbs", "type": "weight"},
    {"description": "power", "value": 5, "unit": "kw", "type": "power"}
  ]
}
```

### Stage 2: Unit Normalization to SI
All measurements converted to standard SI units:
- **Length**: All → meters (m)
  - 20 cm → 0.2 m
  - 20 inches → 0.508 m (NOT equal!)
  
- **Weight**: All → kilograms (kg)
  - 100 lbs → 45.36 kg
  - 100 kg → 100 kg

- **Power**: All → watts (W)
  - 5 kW → 5000 W
  - 5 hp → 3729 W

- **Temperature**: All → Celsius (°C)
  - 100°F → 37.78°C
  - 100°C → 100°C

### Stage 3: Precision Comparison
```
Requirement: 20 cm (= 0.2 m)
Vendor:      20 inches (= 0.508 m)
Difference:  0.308 m
Percentage:  154% OVER REQUIREMENT
Result:      ❌ CRITICAL MISMATCH
```

### Stage 4: Gemini Validation
Gemini re-validates measurement comparisons with strict rules:
- Unit mismatch → ESCALATE to critical issue
- Value difference >5% → ESCALATE to critical issue
- Sets `precisionValidation: "PASS"` or `"FAIL"`

---

## Unit Conversion Tables

### Supported Units

**Length (to meters)**
```
1 m = 1 meter
1 cm = 0.01 m
1 mm = 0.001 m
1 inch = 0.0254 m
1 ft = 0.3048 m
1 km = 1000 m
```

**Weight (to kilograms)**
```
1 kg = 1 kilogram
1 g = 0.001 kg
1 lb = 0.453592 kg
1 oz = 0.0283495 kg
1 ton = 1000 kg
```

**Power (to watts)**
```
1 W = 1 watt
1 kW = 1000 W
1 MW = 1,000,000 W
1 HP = 745.7 W
```

**Temperature (to Celsius)**
```
°C = reference
°F → °C: (F - 32) × 5/9
K → °C: K - 273.15
```

---

## Precision Issues Tracked

### UNIT_MISMATCH
```
Example: Requirement "20 cm" vs Vendor "20 inches"
Severity: MEDIUM (if both values normalize)
Action: Flag but allow if values match after conversion
```

### VALUE_MISMATCH
```
Example: Requirement "100 kg" vs Vendor "50 kg"
Difference: 50%
Severity: CRITICAL (> 5% threshold)
Action: Reject or mark CONDITIONAL
```

### MISSING_UNIT
```
Example: Requirement "20" (no unit) vs Vendor "20 cm"
Severity: CRITICAL
Action: Cannot parse - flag for human review
```

### PRECISION_ERROR
```
Example: Requirement "Intel Core i9" (processor) vs Vendor "Intel Core i5"
Severity: CRITICAL
Action: Direct mismatch - reject
```

---

## Report Output Example

### PASS Case
```
Requirement: 20 cm diameter
Vendor:      7.87 inches diameter
SI Units:    0.2 m = 0.2 m ✓
Match:       Within 5% tolerance
Status:      ✅ PASS
```

### FAIL Case (Unit Mismatch)
```
Requirement: 20 cm diameter
Vendor:      20 inches diameter
SI Units:    0.2 m ≠ 0.508 m ✗
Match:       154% different
Status:      ❌ FAIL - CRITICAL MISMATCH
```

### FAIL Case (Value Mismatch)
```
Requirement: 5 kW power output
Vendor:      4 kW power output
SI Units:    5000 W vs 4000 W
Difference:  20% (exceeds 5% tolerance)
Status:      ❌ FAIL - PRECISION ERROR
```

---

## Frontend Display

### Precision Validation Section
Each vendor report shows:

```
┌─────────────────────────────────────────┐
│  MEASUREMENT PRECISION VALIDATION       │
│  Status: [PASS|FAIL|UNKNOWN]            │
├─────────────────────────────────────────┤
│ [CRITICAL] UNIT_MISMATCH                │
│ Description: Requirement uses cm,       │
│ vendor uses inches. Auto-converted.     │
├─────────────────────────────────────────┤
│ [MEDIUM] VALUE_MISMATCH                 │
│ Description: 25% difference from req.   │
│ Tolerance: 5%                           │
└─────────────────────────────────────────┘
```

Color coding:
- **Green**: No precision issues → All measurements acceptable
- **Red**: Critical issues → Unit/value mismatches detected
- **Yellow**: Minor issues → Tolerance exceeded slightly

---

## Code Integration

### Using Measurement Utilities

```typescript
import { 
  compareMeasurements, 
  normalizeMeasurement,
  analyzePrecision 
} from "@/lib/measurementValidation";

// Compare two measurements
const result = compareMeasurements(
  "20 cm",      // requirement
  "20 inches",  // vendor
  "length",     // type
  0.05          // 5% tolerance
);

console.log(result.matches);           // false
console.log(result.comparison.reason); // "154% difference from requirement"
console.log(result.precisionIssues);   // Array of precision issues
```

### In Route.ts (API)

```typescript
// Stage 2: Extract measurements with units
const specExtraction = await stageVendorSpecExtraction(
  extractedText,
  vendorName
);
// outputs: { measurements: [{description, value, unit, type}] }

// Stage 3&4: Requirement matching with precision checking
const draftReport = await stageRequirementMatching(
  specExtraction,
  baseRequirementsText,
  vendorName
);
// outputs: { measurementComparisons, unitMismatches, precisionErrors }

// Stage 5: Gemini validation of precision
const finalReport = await stageFinalValidation(
  draftReport,
  baseRequirementsText,
  vendorName
);
// outputs: { precisionValidation: "PASS"|"FAIL" }
```

---

## Example Scenarios

### Scenario 1: Simple Unit Mismatch
```
Requirements:
- Diameter: 20 cm
- Weight: 10 kg

Vendor Quote:
- Diameter: 8 inches (= 20.32 cm ✓)
- Weight: 22 lbs (= 10 kg ✓)

Precision Status: ✅ PASS
Unit Mismatch: cm vs inches (flagged, but values match after conversion)
Value Mismatch: None
```

### Scenario 2: Critical Value Mismatch
```
Requirements:
- Processing Power: 20 cores

Vendor Quote:
- Processor: 16 cores

Precision Status: ❌ FAIL
Difference: 20% below requirement
Action: Mark as REJECTED or CONDITIONAL
```

### Scenario 3: Missing Units (Ambiguous)
```
Requirements:
- Length: 20 (NO UNIT - ambiguous!)
- CPU: Intel Xeon 20-core

Vendor Quote:
- Length: 20 cm
- CPU: Intel Xeon 16-core

Precision Status: ⚠️ UNKNOWN
Issues: Cannot parse requirement - flag for human review
```

---

## Tolerance Settings

Default: **5% tolerance** for all measurements

| Type | Tolerance | Reason |
|------|-----------|--------|
| Length | 5% | Manufacturing tolerances |
| Weight | 5% | Component variations |
| Power | 5% | Specification margins |
| Delivery | N/A | Exact match required |
| Specs | 100% | No tolerance for critical specs |

---

## RTDB Structure (Updated)

```json
{
  "quotations": {
    "$sessionId": {
      "$quoteId": {
        "vendorName": "string",
        "parsedData": { ... },
        "finalJsonReport": { ... },
        "precisionValidation": "PASS|FAIL|UNKNOWN",
        "unitMismatches": ["list of unit discrepancies"],
        "measurementPrecisionErrors": ["list of precision gaps"],
        "measurementComparisons": [
          {
            "requirement": "20 cm",
            "vendor": "8 inches",
            "match": false,
            "reason": "Values don't match after unit conversion",
            "percentage_difference": 0.5,
            "critical_issue": false
          }
        ]
      }
    }
  }
}
```

---

## Testing Precision Logic

### Unit Conversion Test
```typescript
compareMeasurements("20 cm", "7.87 inches", "length", 0.05)
// Should return: matches = true (within 5% after conversion)

compareMeasurements("20 cm", "20 inches", "length", 0.05)
// Should return: matches = false (154% difference)
```

### Temperature Conversion Test
```typescript
compareMeasurements("100°F", "37.78°C", "temperature", 0.01)
// Should return: matches = true (same temperature)
```

### Power Conversion Test
```typescript
compareMeasurements("5 kW", "5000 W", "power", 0.01)
// Should return: matches = true (identical)
```

---

## Limitations & Future Improvements

### Current Limitations
1. ❌ No compound units (e.g., "m/s", "kg/m³")
2. ❌ No currency conversion ($ vs €)
3. ❌ No tolerance customization per requirement

### Future Enhancements
1. ✅ Support compound units (velocity, density, pressure)
2. ✅ Currency conversion using exchange rates
3. ✅ Per-requirement tolerance levels (critical: 0%, important: 2%, nice-to-have: 10%)
4. ✅ Historical tolerance tracking for vendor reliability
5. ✅ Measurement uncertainty quantification (±10% margin)

---

**Result**: AI now catches "20 cm vs 20 inches" mismatches and flags them as CRITICAL ✓
