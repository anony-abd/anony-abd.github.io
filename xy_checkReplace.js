/**
 * Swaps standalone variables x/y and differential/operator terms dx/dy, Dx/Dy, d^n x / d^n y, dx^n / dy^n.
 * Uses temporary placeholders to avoid mutual replacement conflicts and protects
 * mathematical functions like exp(x) or cos(x) by using word boundaries (\b).
 * 
 * @param {string} str - The ODE equation string.
 * @returns {string} The equation with x and y swapped.
 */
function swapXY(str) {
    if (!str || typeof str !== 'string') return str;
    
    return str
        // 1. Handle d^n x and d^n y (e.g. d^1x, d^2y)
        .replace(/d\^(\d+)x/g, "__TEMP_D_POW_$1_X__")
        .replace(/d\^(\d+)y/g, "__TEMP_D_POW_$1_Y__")
        
        // 1b. Handle D^n x and D^n y (e.g. D^1x, D^2y)
        .replace(/D\^(\d+)x/g, "__TEMP_D_CAP_POW_$1_X__")
        .replace(/D\^(\d+)y/g, "__TEMP_D_CAP_POW_$1_Y__")
        
        // 2. Handle dx^n and dy^n (e.g. dx^1, dy^2)
        .replace(/dx\^(\d+)/g, "__TEMP_DX_POW_$1__")
        .replace(/dy\^(\d+)/g, "__TEMP_DY_POW_$1__")
        
        // 3. Handle dx and dy as words
        .replace(/\bdx\b/g, "__TEMP_DX__")
        .replace(/\bdy\b/g, "__TEMP_DY__")
        
        // 4. Handle Dx and Dy as words
        .replace(/\bDx\b/g, "__TEMP_DX_CAP__")
        .replace(/\bDy\b/g, "__TEMP_DY_CAP__")
        
        // 5. Handle standalone x and y variables (protecting function names using word boundaries)
        .replace(/\bx\b/g, "__TEMP_X__")
        .replace(/\by\b/g, "__TEMP_Y__")
        .replace(/\bX\b/g, "__TEMP_X_CAP__")
        .replace(/\bY\b/g, "__TEMP_Y_CAP__")
        
        // 6. Restore with swapped values
        .replace(/__TEMP_D_POW_(\d+)_X__/g, "d^$1y")
        .replace(/__TEMP_D_POW_(\d+)_Y__/g, "d^$1x")
        .replace(/__TEMP_D_CAP_POW_(\d+)_X__/g, "D^$1y")
        .replace(/__TEMP_D_CAP_POW_(\d+)_Y__/g, "D^$1x")
        .replace(/__TEMP_DX_POW_(\d+)__/g, "dy^$1")
        .replace(/__TEMP_DY_POW_(\d+)__/g, "dx^$1")
        .replace(/__TEMP_DX__/g, "dy")
        .replace(/__TEMP_DY__/g, "dx")
        .replace(/__TEMP_DX_CAP__/g, "Dy")
        .replace(/__TEMP_DY_CAP__/g, "Dx")
        .replace(/__TEMP_X__/g, "y")
        .replace(/__TEMP_Y__/g, "x")
        .replace(/__TEMP_X_CAP__/g, "Y")
        .replace(/__TEMP_Y_CAP__/g, "X");
}

/**
 * Checks whether the input equation has x as the differentiable variable 
 * (independent variable is y, meaning dy or d^n y is in the denominator, or x', Dx etc.),
 * and if so, swaps x and y across the entire equation.
 * 
 * @param {string} input - The input ODE equation.
 * @returns {Object} An object containing the modified string and a swapped boolean flag.
 */
function xy_checkReplace(input) {
    if (!input || typeof input !== 'string' || !input.trim()) {
        return { modified: '', swapped: false };
    }

    // 1. Leibniz notation: dx/dy or d^n x / dy^n (e.g., dx/dy, dx^1/d^1y, d^2x/dy^2, d(sin(x))/dy)
    // We check if "dy" (or "d^n y", "dy^n", "d(y)") is in the denominator, indicating y is the independent variable
    const isLeibnizX = /\/\s*d(\^\d+)?\(?y\)?(\^\d+)?\b/i.test(input);

    // 2. Prime notation: x', x'', etc. (differentiable variable is x)
    const isPrimeX = /\bx'+/i.test(input);

    // 3. Operator notation: Dx, D^1x, D^2x, etc. (differentiable variable is x, with uppercase D operator)
    const isOperatorX = /\bD(\^\d+)?x\b/.test(input);

    // If any of these are true, x is the differentiable variable (with y as the independent variable)
    if (isLeibnizX || isPrimeX || isOperatorX) {
        console.log(`Detected x as the differentiable variable. Swapping x and y...`);
        const swappedInput = swapXY(input);
        console.log(`Swapped equation: ${swappedInput}`);
        return { modified: swappedInput, swapped: true };
    }

    console.log(`Detected y as the differentiable variable (default). No swap needed.`);
    return { modified: input, swapped: false };
}

if (typeof module !== 'undefined') {
    module.exports = { xy_checkReplace, swapXY };
}