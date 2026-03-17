/**
 * Measurement Validation & Unit Conversion Utilities
 * Ensures high precision in procurement comparisons
 * Handles: Length (cm, inches), Weight (kg, lbs), Power (W, kW), Temperature (°C, °F)
 */

export interface MeasurementComparison {
  requirement: string;
  vendor: string;
  match: boolean;
  reason: string;
  percentage_difference: number;
  critical_issue: boolean;
}

export interface PrecisionIssue {
  type: "UNIT_MISMATCH" | "VALUE_MISMATCH" | "MISSING_UNIT" | "PRECISION_ERROR";
  description: string;
  severity: "LOW" | "MEDIUM" | "CRITICAL";
  requirement: string;
  vendor: string;
}

/**
 * Unit conversion tables (all to SI base units)
 */
const UNIT_CONVERSIONS = {
  length: {
    m: 1,
    meter: 1,
    cm: 0.01,
    mm: 0.001,
    inch: 0.0254,
    in: 0.0254,
    ft: 0.3048,
    foot: 0.3048,
    km: 1000,
  },
  weight: {
    kg: 1,
    g: 0.001,
    lb: 0.453592,
    lbs: 0.453592,
    oz: 0.0283495,
    ton: 1000,
  },
  power: {
    w: 1,
    kw: 1000,
    mw: 1000000,
    hp: 745.7,
  },
  temperature: {
    c: 1,
    celsius: 1,
    f: 0.5556,
    fahrenheit: 0.5556,
    k: 1,
    kelvin: 1,
  },
};

/**
 * Extract numeric value and unit from a string
 * Examples: "20 cm" → {value: 20, unit: "cm"}
 */
export function parseValueWithUnit(
  input: string
): { value: number | null; unit: string | null; raw: string } {
  // Remove extra whitespace
  const cleaned = input.trim();

  // Match pattern: number followed by unit
  const match = cleaned.match(/^([\d.]+)\s*([a-zA-Z°]+)$/);

  if (!match) {
    return {
      value: null,
      unit: null,
      raw: cleaned,
    };
  }

  return {
    value: parseFloat(match[1]),
    unit: match[2].toLowerCase(),
    raw: cleaned,
  };
}

/**
 * Normalize a measurement to SI units
 */
export function normalizeMeasurement(
  value: number,
  unit: string,
  type: "length" | "weight" | "power" | "temperature"
): { normalizedValue: number; siUnit: string } | null {
  const unitLower = unit.toLowerCase().trim();
  const conversions = UNIT_CONVERSIONS[type];

  if (!conversions || !conversions[unitLower as keyof typeof conversions]) {
    return null;
  }

  let normalizedValue = value;
  let siUnit = "";

  switch (type) {
    case "length": {
      const lengthConversions = conversions as typeof UNIT_CONVERSIONS.length;
      normalizedValue = value * lengthConversions[unitLower as keyof typeof lengthConversions];
      siUnit = "m";
      break;
    }
    case "weight": {
      const weightConversions = conversions as typeof UNIT_CONVERSIONS.weight;
      normalizedValue = value * weightConversions[unitLower as keyof typeof weightConversions];
      siUnit = "kg";
      break;
    }
    case "power": {
      const powerConversions = conversions as typeof UNIT_CONVERSIONS.power;
      normalizedValue = value * powerConversions[unitLower as keyof typeof powerConversions];
      siUnit = "W";
      break;
    }
    case "temperature":
      if (unitLower === "f" || unitLower === "fahrenheit") {
        normalizedValue = (value - 32) * (5 / 9);
      } else if (unitLower === "k" || unitLower === "kelvin") {
        normalizedValue = value - 273.15;
      }
      siUnit = "°C";
      break;
  }

  return {
    normalizedValue: parseFloat(normalizedValue.toFixed(6)),
    siUnit,
  };
}

/**
 * Compare two measurements with unit conversion and precision checking
 * Returns detailed comparison with potential precision issues
 */
export function compareMeasurements(
  requiredText: string,
  vendorText: string,
  type: "length" | "weight" | "power" | "temperature",
  tolerance: number = 0.05 // 5% tolerance
): {
  matches: boolean;
  comparison: MeasurementComparison;
  precisionIssues: PrecisionIssue[];
} {
  const issues: PrecisionIssue[] = [];

  const reqParsed = parseValueWithUnit(requiredText);
  const vendorParsed = parseValueWithUnit(vendorText);

  // Check if parsing failed
  if (reqParsed.value === null || vendorParsed.value === null) {
    return {
      matches: false,
      comparison: {
        requirement: requiredText,
        vendor: vendorText,
        match: false,
        reason: "Could not parse one or both measurements",
        percentage_difference: -1,
        critical_issue: true,
      },
      precisionIssues: [
        {
          type: "MISSING_UNIT",
          description: "Could not parse numeric value and/or unit",
          severity: "CRITICAL",
          requirement: requiredText,
          vendor: vendorText,
        },
      ],
    };
  }

  // Normalize both measurements
  const reqNorm = normalizeMeasurement(
    reqParsed.value,
    reqParsed.unit || "UNKNOWN",
    type
  );
  const vendorNorm = normalizeMeasurement(
    vendorParsed.value,
    vendorParsed.unit || "UNKNOWN",
    type
  );

  // Check if normalization failed
  if (!reqNorm || !vendorNorm) {
    issues.push({
      type: "UNIT_MISMATCH",
      description: `Could not convert units: requirement="${reqParsed.unit}", vendor="${vendorParsed.unit}"`,
      severity: "CRITICAL",
      requirement: requiredText,
      vendor: vendorText,
    });
    return {
      matches: false,
      comparison: {
        requirement: requiredText,
        vendor: vendorText,
        match: false,
        reason: `Unit conversion failed: ${reqParsed.unit} and/or ${vendorParsed.unit} not supported`,
        percentage_difference: -1,
        critical_issue: true,
      },
      precisionIssues: issues,
    };
  }

  // Check for unit mismatch
  if (reqParsed.unit !== vendorParsed.unit) {
    issues.push({
      type: "UNIT_MISMATCH",
      description: `Requirement uses "${reqParsed.unit}", vendor uses "${vendorParsed.unit}"`,
      severity: "MEDIUM",
      requirement: requiredText,
      vendor: vendorText,
    });
  }

  // Calculate difference
  const difference = Math.abs(reqNorm.normalizedValue - vendorNorm.normalizedValue);
  const diffPercentage = (difference / reqNorm.normalizedValue) * 100;
  const matches = diffPercentage <= tolerance * 100;

  if (!matches) {
    issues.push({
      type: "VALUE_MISMATCH",
      description: `${diffPercentage.toFixed(2)}% difference (tolerance: ${tolerance * 100}%)`,
      severity: diffPercentage > tolerance * 100 * 2 ? "CRITICAL" : "MEDIUM",
      requirement: requiredText,
      vendor: vendorText,
    });
  }

  return {
    matches,
    comparison: {
      requirement: `${reqParsed.value} ${reqParsed.unit} (= ${reqNorm.normalizedValue} ${reqNorm.siUnit})`,
      vendor: `${vendorParsed.value} ${vendorParsed.unit} (= ${vendorNorm.normalizedValue} ${vendorNorm.siUnit})`,
      match: matches,
      reason: matches
        ? "Specifications meet requirements"
        : `${diffPercentage.toFixed(2)}% difference from requirement`,
      percentage_difference: parseFloat(diffPercentage.toFixed(2)),
      critical_issue: diffPercentage > tolerance * 100 * 2,
    },
    precisionIssues: issues,
  };
}

/**
 * Analyze all measurements from a quotation report
 */
export function analyzePrecision(report: Record<string, any>): {
  totalIssues: number;
  criticalIssues: number;
  summary: string;
  issues: PrecisionIssue[];
} {
  const issues: PrecisionIssue[] = [];

  // Extract precision errors from report
  if (report.unitMismatches) {
    report.unitMismatches.forEach((mismatch: string) => {
      issues.push({
        type: "UNIT_MISMATCH",
        description: mismatch,
        severity: "MEDIUM",
        requirement: "See unitMismatches",
        vendor: "See unitMismatches",
      });
    });
  }

  if (report.measurementPrecisionErrors) {
    report.measurementPrecisionErrors.forEach((error: string) => {
      issues.push({
        type: "PRECISION_ERROR",
        description: error,
        severity: "CRITICAL",
        requirement: "See measurementPrecisionErrors",
        vendor: "See measurementPrecisionErrors",
      });
    });
  }

  const criticalCount = issues.filter((i) => i.severity === "CRITICAL").length;

  return {
    totalIssues: issues.length,
    criticalIssues: criticalCount,
    summary:
      criticalCount > 0
        ? `${criticalCount} CRITICAL precision issues found`
        : issues.length > 0
        ? `${issues.length} precision issues found`
        : "No precision issues detected",
    issues,
  };
}
