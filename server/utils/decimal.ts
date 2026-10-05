function normaliseDecimalString(value: string): string {
  const trimmed = value.trim();

  if (!trimmed || trimmed === '0') return '0';
  
  const negative = trimmed.startsWith('-');
  const absolute = negative ? trimmed.slice(1) : trimmed;
  const [wholeRaw = '0', fractionRaw = ''] = absolute.split('.');
  const whole = wholeRaw.replace(/^0+(?=\d)/, '') || '0';
  const fraction = fractionRaw.replace(/0+$/, '');

  if (fraction.length === 0) return negative ? `-${whole}` : whole;
  
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

function decimalPlaces(value: string): number {
  const normalised = normaliseDecimalString(value);

  if (!normalised.includes('.')) return 0;

  return normalised.split('.')[1]?.length ?? 0;
}

function toScaledInteger(value: string, scale: number): bigint {
  const normalised = normaliseDecimalString(value);
  const [whole, fraction = ''] = normalised.split('.');

  const digits = `${whole.replace(/^-?0+(?=\d)/, '') || '0'}${
    fraction.padEnd(scale, '0').slice(0, scale)
  }`;

  const number = BigInt(digits.replace(/^-/, ''));

  return normalised.startsWith('-') ? -number : number;
}

function toDecimalString(value: bigint, scale: number): string {
  if (scale === 0) return value.toString();
  
  const absolute = value < 0n ? -value : value; // BigInt to prevent floating-point errors
  const digits = absolute.toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, -scale) || '0';
  const fraction = digits.slice(-scale).replace(/0+$/, '');

  return `${value < 0n ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function compareDecimalStrings(left: string, right: string): number {
  const scale = Math.max(
    decimalPlaces(left),
    decimalPlaces(right)
  );

  const leftValue = toScaledInteger(left, scale);
  const rightValue = toScaledInteger(right, scale);

  if (leftValue < rightValue) return -1;
  if (leftValue > rightValue) return 1;
  return 0;
}

function multiplyDecimalStrings(left: string, right: string): string {
  const scale = Math.max(
    decimalPlaces(left),
    decimalPlaces(right)
  );

  const scaledLeft  = toScaledInteger(left, scale);
  const scaledRight = toScaledInteger(right, scale);

  return toDecimalString(
    (scaledLeft * scaledRight) / 10n ** BigInt(scale),
    scale
  );
}

function roundDownToStep(value: string, step: string): string {
  const normalisedValue = normaliseDecimalString(value);
  const normalisedStep = normaliseDecimalString(step);

  const scale = Math.max(
    decimalPlaces(normalisedValue),
    decimalPlaces(normalisedStep)
  );

  const valueScaled = toScaledInteger(normalisedValue, scale);
  const stepScaled = toScaledInteger(normalisedStep, scale);

  if (stepScaled <= 0n) return normalisedValue;

  const quotient = valueScaled / stepScaled;
  const rounded = quotient * stepScaled;

  return toDecimalString(rounded, scale);
}

function roundToTickSize(value: string, tick: string): string {
  const normalisedValue = normaliseDecimalString(value);
  const normalisedTick = normaliseDecimalString(tick);

  const scale = Math.max(
    decimalPlaces(normalisedValue),
    decimalPlaces(normalisedTick)
  );

  const stepScaled = toScaledInteger(normalisedTick, scale);

  if (stepScaled <= 0n) return normalisedValue;

  const valueScaled = toScaledInteger(normalisedValue, scale);
  const rounded = (valueScaled / stepScaled) * stepScaled;

  return toDecimalString(rounded, scale);
}