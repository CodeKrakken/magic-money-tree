"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatNumber = formatNumber;
function formatNumber(number, decimals = 2) {
    let outputNumber = parseFloat(number.toFixed(decimals));
    if (!outputNumber) {
        outputNumber = formatNumber(number, decimals + 1);
    }
    return outputNumber;
}
