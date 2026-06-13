if (typeof nerdamer === 'undefined' && typeof require !== 'undefined') {
    var nerdamer = require('nerdamer/all');
}

function simplifyTrigIdentities(expr) {
    let exprStr = expr.toString();
    const secRegex = /\bsec\(/g;
    const cscRegex = /\b(csc|cosec)\(/g;
    let args = new Set();
    function extractArgs(regex) {
        let match;
        while ((match = regex.exec(exprStr)) !== null) {
            let startOfArg = match.index + match[0].length;
            let depth = 1;
            let j = startOfArg;
            while (j < exprStr.length && depth > 0) {
                if (exprStr[j] === '(') depth++;
                else if (exprStr[j] === ')') depth--;
                j++;
            }
            if (depth === 0) {
                let arg = exprStr.slice(startOfArg, j - 1);
                args.add(arg);
            }
        }
    }
    extractArgs(secRegex);
    extractArgs(cscRegex);
    for (let arg of args) {
        expr = expr.sub(`sec(${arg})^2`, `1 + tan(${arg})^2`);
        expr = expr.sub(`csc(${arg})^2`, `1 + cot(${arg})^2`);
        expr = expr.sub(`cosec(${arg})^2`, `1 + cot(${arg})^2`);
    }
    return expr;
}

if (typeof nerdamer !== 'undefined') {
    const originalNerdamer = nerdamer;
    const wrappedNerdamer = function (expression, ...args) {
        if (typeof expression === 'string') {
            expression = expression.replace(/\bcosec\b/g, 'csc');
        }
        let expr = originalNerdamer(expression, ...args);
        if (expr && typeof expr.simplify === 'function') {
            const originalSimplify = expr.simplify;
            expr.simplify = function (...sArgs) {
                let subbedExpr = simplifyTrigIdentities(expr);
                return originalSimplify.apply(subbedExpr, sArgs);
            };
        }
        return expr;
    };
    Object.assign(wrappedNerdamer, originalNerdamer);
    for (let key in originalNerdamer) {
        if (typeof originalNerdamer[key] === 'function') {
            wrappedNerdamer[key] = originalNerdamer[key].bind(originalNerdamer);
        }
    }
    nerdamer = wrappedNerdamer;
}


function solveLinearY(problem, Yvar) {
    if (!problem || typeof problem !== 'string') return null;
    try {
        let lhs = problem.split('=')[0].trim();
        let rhs = problem.split('=')[1] ? problem.split('=')[1].trim() : '0';
        let eqExpr = `(${lhs}) - (${rhs})`;

        // Check if linear in Yvar by differentiating twice wrt Yvar
        let d2 = nerdamer(`diff(diff(${eqExpr}, ${Yvar}), ${Yvar})`).simplify().toString();
        if (d2 === '0') {
            let A = nerdamer(`diff(${eqExpr}, ${Yvar})`).simplify().toString();
            let B = nerdamer(eqExpr).sub(Yvar, '0').simplify().toString();
            if (A !== '0') {
                return nerdamer(`-(${B})/(${A})`).simplify().toString();
            }
        }
    } catch (e) {
        console.error("Error in solveLinearY:", e);
    }
    return null;
}


function convertTrigReciprocals(str) {
    if (!str || typeof str !== 'string') return str;

    const functions = ['cosec', 'sec', 'csc', 'cot', 'tan'];
    const replacements = {
        'sec': '(1/cos($1))',
        'cosec': '(1/sin($1))',
        'csc': '(1/sin($1))',
        'cot': '(cos($1)/sin($1))',
        'tan': '(sin($1)/cos($1))'
    };

    for (let fn of functions) {
        let idx = str.indexOf(fn + '(');
        while (idx !== -1) {
            let bracketCount = 1;
            let j = idx + fn.length + 1;
            while (j < str.length && bracketCount > 0) {
                if (str[j] === '(') bracketCount++;
                else if (str[j] === ')') bracketCount--;
                j++;
            }
            if (bracketCount === 0) {
                let arg = str.slice(idx + fn.length + 1, j - 1);
                let fullMatch = str.slice(idx, j);
                let rep = replacements[fn].replaceAll('$1', arg);
                str = str.replace(fullMatch, rep);
                idx = str.indexOf(fn + '('); // restart search
            } else {
                idx = str.indexOf(fn + '(', idx + 1);
            }
        }
    }
    return str;
}

// Helper to insert implicit multiplication stars (e.g. 3y^2 -> 3*y^2, x(y+1) -> x*(y+1))
// This prevents Nerdamer's tokenizer from creating unified tokens like "3y"
// which causes it to treat the whole term as the number 3, ignoring the variable y
function insertImplicitStars(str) {
    if (!str || typeof str !== 'string') return str;

    return str
        // Insert star between a number and a variable/paren (e.g. 3y -> 3*y, 3( -> 3*()
        .replace(/(\d+)\s*([a-zA-Z\(])/g, '$1*$2')
        // Insert star between a closing paren and an opening paren (e.g. )( -> )*( )
        .replace(/(\))\s*(\()/g, '$1*$2')
        // Insert star between a closing paren and a variable/number (e.g. )y -> )*y
        .replace(/(\))\s*([a-zA-Z\d])/g, '$1*$2')
        // Insert star between a variable and an opening paren (e.g. y( -> y*()
        // avoiding matching function names like sin(, cos(, tan(, exp(, integrate(
        .replace(/\b(?!sin|cos|tan|cot|sec|csc|cosec|asin|acos|atan|acot|asec|acsc|acosec|log|ln|exp|sinh|cosh|tanh|sqrt|integrate|diff|pdiff|limit|sum|product|defint|nrt|abs|fact|squareroot|secondroot|secndroot|thirdroot|cuberoot|fourthroot|forthroot|fifthroot|sixthroot|seventhroot|eighthroot|ninthroot|tenthroot|multiply|matrix|vector|eigenvalues|eigenvectors|rref|basis|transpose|det|inverse|invert|identity|null|conjugate|arg|realpart|imagpart|polarform|rectform|dot|cross|mag|normalize|angle)([a-zA-Z]+)(\()/g, '$1*$2')
        // Insert star between standalone variables x/y and subsequent variables/functions (e.g. xe^y -> x*e^y, xy -> x*y)
        .replace(/\b([xy])([a-zA-Z])/gi, (match, p1, p2) => p1 + '*' + p2);
}

// Globally override Frac.simple in Nerdamer core to catch and safely resolve any NaN fraction crashes
// This handles cases where intermediate calculations in the solver have resulted in NaN decimals,
// preventing the arbitrary-precision bigInt parser from throwing "Invalid integer: NaN"
if (typeof nerdamer !== 'undefined' && typeof nerdamer.getCore === 'function') {
    const core = nerdamer.getCore();
    if (core && core.Frac && typeof core.Frac.simple === 'function') {
        const originalFracSimple = core.Frac.simple;
        core.Frac.simple = function (n) {
            let nstr = "";
            try {
                nstr = String(core.Utils.scientificToDecimal(n));
            } catch (e) {
                nstr = "NaN";
            }

            // Check strictly for real NaN values (JavaScript NaN, literal "NaN", or bigDec NaN)
            // to make sure standard symbolic variables like 'y', 'x' or 'dy' are never turned into 0s
            if (nstr === 'NaN' || nstr.includes('NaN') || (typeof n === 'number' && isNaN(n)) || (n && n.isNaN && n.isNaN())) {
                console.log("Safe handle of NaN inside overridden Frac.simple");
                return core.Frac.quick(0, 1); // Returns a safe 0/1 fraction instead of throwing an error
            }

            return originalFracSimple.call(core.Frac, n);
        };
    }
}

// Globally override nerdamer.convertToLaTeX to make it robust against NaN and global variable substitutions
if (typeof nerdamer !== 'undefined' && typeof nerdamer.getCore === 'function') {
    // Make sure we have the core overrides already
}
if (typeof nerdamer !== 'undefined' && typeof nerdamer.convertToLaTeX === 'function') {
    const originalConvertToLaTeX = nerdamer.convertToLaTeX;
    nerdamer.convertToLaTeX = function (expression, option) {
        let varsBackup = {};
        if (typeof nerdamer !== 'undefined' && typeof nerdamer.getVars === 'function') {
            varsBackup = nerdamer.getVars('object');
            nerdamer.clearVars();
        }

        // Clean expression by injecting implicit stars
        let cleanedExpression = insertImplicitStars(expression);

        try {
            try {
                let parsed = nerdamer(cleanedExpression);
                let isDecimal = /\d+\.\d+/.test(cleanedExpression);
                let latex = isDecimal ? parsed.toTeX('decimal') : parsed.toTeX();
                if (latex && typeof latex === 'string' && latex.trim()) {
                    return latex;
                }
            } catch (err) {
                // Fallback to default LaTeX converter if parsing or toTeX fails
            }
            let opt = option;
            if (/\d+\.\d+/.test(cleanedExpression)) {
                opt = 'decimal';
            }
            return originalConvertToLaTeX.call(nerdamer, cleanedExpression, opt);
        } finally {
            if (typeof nerdamer !== 'undefined' && typeof nerdamer.setVar === 'function') {
                for (let v in varsBackup) {
                    nerdamer.setVar(v, varsBackup[v]);
                }
            }
        }
    };
}

// Helper to preprocess Leibniz notations like (d^1y/dx^1) or d^1y/dx^1 to Y1
// This prevents Nerdamer's parser from failing with "Invalid integer: NaN"
function preprocessLeibnizY(str) {
    if (!str || typeof str !== 'string') return str;
    return str.replace(/(?:\(\s*)?d\^(\d+)y\/dx\^\2(?:\s*\))?/g, (match, ord1, ord2) => 'Y' + ord1)
        .replace(/(?:\(\s*)?d\^(\d+)y\/dx\^(\d+)(?:\s*\))?/g, (match, ord1, ord2) => 'Y' + ord1);
}

function replaceIntegrateWithInt(str) {
    let patterns = [
        '\\text{integrate}\\left(',
        '\\text{integrate}(',
        'integrate\\left(',
        'integrate('
    ];

    let found = true;
    while (found) {
        found = false;
        for (let pat of patterns) {
            let idx = str.indexOf(pat);
            if (idx !== -1) {
                let startOfArgs = idx + pat.length;
                let parenDepth = 1;
                let j = startOfArgs;
                let commaIdx = -1;
                let isLeftRight = pat.includes('\\left(');

                while (j < str.length && parenDepth > 0) {
                    if (isLeftRight) {
                        if (str.startsWith('\\left(', j)) {
                            parenDepth++;
                            j += 6;
                        } else if (str.startsWith('\\right)', j)) {
                            parenDepth--;
                            if (parenDepth === 0) {
                                break;
                            }
                            j += 7;
                        } else {
                            if (str[j] === ',' && parenDepth === 1) {
                                commaIdx = j;
                            }
                            j++;
                        }
                    } else {
                        if (str[j] === '(') {
                            parenDepth++;
                        } else if (str[j] === ')') {
                            parenDepth--;
                            if (parenDepth === 0) {
                                break;
                            }
                        } else if (str[j] === ',' && parenDepth === 1) {
                            commaIdx = j;
                        }
                        j++;
                    }
                }

                if (parenDepth === 0) {
                    let endOfMatch = j + (isLeftRight ? 7 : 1);
                    if (commaIdx !== -1) {
                        let expr = str.slice(startOfArgs, commaIdx).trim();
                        let variable = str.slice(commaIdx + 1, j).trim();
                        variable = variable.replace(/\\/g, '').trim();

                        let replacement = `\\int {${expr}}\\, d${variable}`;
                        str = str.slice(0, idx) + replacement + str.slice(endOfMatch);
                        found = true;
                        break;
                    }
                }
            }
        }
    }
    return str;
}

function katexFormat(input) {
    if (!input) return "";

    // Preprocess Leibniz notation terms to safe placeholders
    let cleanedInput = preprocessLeibnizY(input);

    // Split by "=" to convert LHS and RHS separately
    // This provides ultimate robustness against equation parser quirks in Nerdamer
    let parts = cleanedInput.split('=');
    let latexParts = parts.map(p => {
        let trimmed = p.trim();
        if (!trimmed) return "";
        return formatRawMathToLaTeX(trimmed);
    });
    let latex = latexParts.join(' = ');

    // Replace Y1, Y2, etc. with proper LaTeX derivative notations
    latex = latex.replace(/Y_?\{?(\d+)\}?/g, (match, ord) => {
        if (ord === '1') {
            return '\\left(\\frac{dy}{dx}\\right)';
        } else {
            return `\\frac{d^{${ord}}y}{dx^{${ord}}}`;
        }
    });

    latex = replaceIntegrateWithInt(latex).replaceAll('\\mathrm{log}', '\\log');

    console.log(`katexFormat(${input}): ${latex}`);
    return latex;
}

// dy/dx to dx/dy format
function dxdykatexFormat(input) {
    if (!input) return "";

    // Swap standalone x and y variables for dx/dy conversions
    input = swapXY(input);

    // Preprocess Leibniz notation terms to safe placeholders
    let cleanedInput = preprocessLeibnizY(input);

    // Split by "=" to convert LHS and RHS separately
    let parts = cleanedInput.split('=');
    let latexParts = parts.map(p => {
        let trimmed = p.trim();
        if (!trimmed) return "";
        return formatRawMathToLaTeX(trimmed);
    });
    let latex = latexParts.join(' = ');

    // Replace Y1, Y2, etc. with proper LaTeX swapped derivative notations
    latex = latex.replace(/Y_?\{?(\d+)\}?/g, (match, ord) => {
        if (ord === '1') {
            return '\\left(\\frac{dx}{dy}\\right)';
        } else {
            return `\\frac{d^{${ord}}x}{dy^{${ord}}}`;
        }
    });

    latex = replaceIntegrateWithInt(latex).replaceAll('\\mathrm{log}', '\\log');

    console.log(`dxdykatexFormat(${input}): ${latex}`);
    return latex;
}

//Storing equation from input
let boxInput = null;
if (typeof document !== 'undefined') {
    boxInput = document.getElementById("ode");
}

function resizeTextarea(el) {
    if (!el) return;

    const isMobile = window.innerWidth <= 600;
    if (el.id === 'math') return; // Let updateMathOverlay handle math resizing!

    if (el.value == '') {
        if (!isMobile && el.id !== 'math') {
            if (el.style.width !== '400px') el.style.width = '400px';
        }

        let defaultHeight = isMobile ? '44px' : '60px';
        if (el.style.height !== defaultHeight) el.style.height = defaultHeight;

        if (!isMobile && el.id !== 'math') {
            const container = el.closest('.ode-input-container');
            if (container) {
                container.style.width = '400px';
            }
        }
    } else {
        // Get computed style for accurate font, padding, and border
        let computedStyle = window.getComputedStyle(el);
        let fontSize = computedStyle.fontSize || (isMobile ? '15.2px' : '14.4px');
        let fontFamily = computedStyle.fontFamily || 'Poppins, sans-serif';
        let fontWeight = computedStyle.fontWeight || 'normal';
        let font = `${fontWeight} ${fontSize} ${fontFamily}`;

        // Cache the canvas element
        const canvas = el._canvas || (el._canvas = document.createElement("canvas"));
        const context = canvas.getContext("2d");
        context.font = font;

        let lines = el.value.split('\n');
        let maxLineWidth = 0;
        for (let line of lines) {
            let w = context.measureText(line).width;
            if (w > maxLineWidth) maxLineWidth = w;
        }

        if (!isMobile && el.id === 'math' && typeof window !== 'undefined' && window.mathSolverLastSolution) {
            let plainSol = "=> " + window.mathSolverLastSolution.replace(/\\[a-zA-Z]+/g, '').replace(/[{}]/g, '');
            let w = context.measureText(plainSol).width;
            if (w > maxLineWidth) maxLineWidth = w;
        }

        // Width calculation (desktop only, on mobile width is 100%)
        if (!isMobile) {
            let paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
            let paddingRight = parseFloat(computedStyle.paddingRight) || 0;
            let borderLeft = parseFloat(computedStyle.borderLeftWidth) || 0;
            let borderRight = parseFloat(computedStyle.borderRightWidth) || 0;
            let extraWidth = paddingLeft + paddingRight + borderLeft + borderRight;

            let newWidth = Math.max(400, maxLineWidth + extraWidth + 6);
            let finalWidth = newWidth + 'px';
            if (el.id !== 'math') {
                if (el.style.width !== finalWidth) {
                    el.style.width = finalWidth;
                }
                const isVisible = el.style.display !== 'none';
                const container = el.closest('.ode-input-container');
                if (container && isVisible) {
                    container.style.width = finalWidth;
                }
            }
        }

        // Height calculation
        let paddingTop = parseFloat(computedStyle.paddingTop) || 0;
        let paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;
        let borderTop = parseFloat(computedStyle.borderTopWidth) || 0;
        let borderBottom = parseFloat(computedStyle.borderBottomWidth) || 0;
        let extraHeight = paddingTop + paddingBottom + borderTop + borderBottom;

        let lineHeight = parseFloat(computedStyle.lineHeight);
        if (isNaN(lineHeight)) {
            lineHeight = parseFloat(fontSize) * 1.3; // standard line-height
        }

        let linesCount = lines.length;
        let extraPadding = 0;
        if (!isMobile && el.id === 'math' && typeof window !== 'undefined' && window.mathSolverLastSolution) {
            linesCount += 2;
            extraPadding = 28;
        }

        let minHeight = isMobile ? 44 : 60;
        let calculatedHeight = Math.ceil(linesCount * lineHeight + extraHeight + extraPadding);
        let newHeight = Math.max(minHeight, calculatedHeight);

        // On mobile, limit max height of textarea to 150px
        if (isMobile) {
            newHeight = Math.min(150, newHeight);
        }

        let finalHeight = newHeight + 'px';
        if (el.style.height !== finalHeight) {
            el.style.height = finalHeight;
        }
    }
}

function renderKatex(expr, el, options = {}) {
    if (typeof katex === 'undefined') return;
    const defaultMacros = {
        "\\csc": "\\operatorname{cosec}",
        "\\csch": "\\operatorname{cosech}",
        "\\acsc": "\\operatorname{cosec}^{-1}",
        "\\acsch": "\\operatorname{cosech}^{-1}"
    };
    const mergedOptions = Object.assign({
        throwOnError: false,
        trust: true
    }, options);
    mergedOptions.macros = Object.assign({}, defaultMacros, options.macros || {});
    katex.render(expr, el, mergedOptions);
}

if (boxInput) {
    boxInput.addEventListener('input', function () {
        resizeTextarea(this);
    });

    boxInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            setTimeout(() => {
                // Trigger the input event to recalculate size on newline insertion
                this.dispatchEvent(new Event('input'));
            }, 0);
        }
    });
}

//Global Parameters for display
let tobeInteg = '';
let lastMathValue = '';
let lastOdeValue = '';
let isProgrammaticUpdate = false;
let solId = null;
if (typeof document !== 'undefined') {
    solId = document.getElementById('solution');
}

// Global Step variables for LaTeX displaying
let linear_P_step = '';
let linear_Q_step = '';
let linear_IF_step = '';
let linear_integ_step = '';
let bernoulli_sub_step = '';
let bernoulli_linear_step = '';
let separable_separated_step = '';
let separable_integration_step = '';
let separable_form_step = '';
let separable_sol_step = '';
let exact_M_N_step = '';
let exact_verification_step = '';
let exact_u_step = '';
let exact_form_step = '';
let exact_sol_step = '';

let const_homogeneous_lambda_step = '';
let const_homogeneous_roots_step = '';
let const_homogeneous_sol_step = '';
let const_nonhomogeneous_method_step = '';
let const_nonhomogeneous_particular_step = '';
let euler_cauchy_char_step = '';
let euler_cauchy_roots_step = '';
let euler_cauchy_sol_step = '';
let system_companion_matrix_step = '';
let system_eigenvalues_step = '';
let legendre_n_step = '';
let legendre_sol_step = '';
let bessel_v_step = '';
let bessel_sol_step = '';
let frobenius_indicial_step = '';
let frobenius_recurrence_step = '';
let frobenius_sol_step = '';
let ordinary_series_recurrence_step = '';
let ordinary_series_sol_step = '';
let initial_value_step = '';
let particular_solution_step = '';

// Track last visible panel count to detect layout changes
let _lastVisiblePanelCount = 0;

// Adjust panel flex values based on visibility and drag widths
function updatePanelFlex() {
    if (typeof document === 'undefined') return;
    const solutionPanel = document.getElementById('solutionPanel');
    const plotPanel = document.getElementById('plotPanel');
    const savedPanel = document.getElementById('savedPanel');
    const resizer = document.getElementById('panelResizer');
    const resizer2 = document.getElementById('panelResizer2');

    if (!solutionPanel || !plotPanel || !savedPanel) return;

    const solVisible = solutionPanel.style.display !== 'none';
    const plotVisible = plotPanel.style.display !== 'none';
    const savedVisible = savedPanel.style.display !== 'none';

    // Update resizer visibilities
    if (resizer) {
        resizer.style.display = (solVisible && plotVisible) ? '' : 'none';
    }
    if (resizer2) {
        resizer2.style.display = ((solVisible || plotVisible) && savedVisible) ? '' : 'none';
    }

    const allPanels = [solutionPanel, plotPanel, savedPanel];
    const visiblePanels = allPanels.filter(p => p.style.display !== 'none');

    // When the number of visible panels changes, clear stored drag widths
    // so panels redistribute equally instead of overflowing the container.
    if (visiblePanels.length !== _lastVisiblePanelCount) {
        allPanels.forEach(p => {
            delete p.dataset.dragWidth;
            p.style.flex = '1 1 0';
        });
        _lastVisiblePanelCount = visiblePanels.length;
        return;
    }

    if (visiblePanels.length === 1) {
        visiblePanels[0].style.flex = '1 1 0';
    } else if (visiblePanels.length > 1) {
        visiblePanels.forEach(panel => {
            panel.style.flex = panel.dataset.dragWidth ? `0 0 ${panel.dataset.dragWidth}` : '1 1 0';
        });
    }
}

// Toggle an individual output panel on/off via its tab button
function togglePanel(panel) {
    const panelEl = document.getElementById(panel === 'solution' ? 'solutionPanel' : 'plotPanel');
    const btn = document.getElementById(panel === 'solution' ? 'solutionToggle' : 'plotToggle');
    if (!panelEl || !btn) return;

    const isVisible = panelEl.style.display !== 'none';
    panelEl.style.display = isVisible ? 'none' : '';
    btn.classList.toggle('active', !isVisible);

    updatePanelFlex();
}

function toggleSavedPanel() {
    const savedPanel = document.getElementById('savedPanel');
    const savedBtn = document.getElementById('mode-saved');
    const savedToggle = document.getElementById('savedToggle');
    if (!savedPanel) return;

    const isVisible = savedPanel.style.display !== 'none';
    savedPanel.style.display = isVisible ? 'none' : 'flex';
    if (savedBtn) savedBtn.classList.toggle('active', !isVisible);
    if (savedToggle) savedToggle.classList.toggle('active', !isVisible);

    // Make outputRow visible if any panel is visible
    const outputRow = document.getElementById('outputRow');
    if (outputRow) {
        outputRow.style.display = 'flex';
    }
    const panelTabRow = document.getElementById('panelTabRow');
    if (panelTabRow) {
        panelTabRow.style.display = 'flex';
    }

    updatePanelFlex();
}

function getEquation() {
    if (typeof document === 'undefined') return;
    let userInput = document.getElementById("ode").value;

    let rawDisplayInput = userInput;
    const mathEl = document.getElementById("math");
    const mathBtn = document.getElementById('mode-math');
    if (mathBtn && mathBtn.classList.contains('active') && mathEl) {
        rawDisplayInput = mathEl.value;
    }

    // Interpret <=, >=, approx= as = for calculations
    userInput = userInput.replace(/<=/g, '=')
        .replace(/>=/g, '=')
        .replace(/approx=/g, '=')
        .replace(/dho/g, 'd')
        .replace(/∂/g, 'd')
        .replace(/\\partial/g, 'd');

    userInput = preprocessTrigPowers(userInput);
    userInput = convertLeibnizToDiff(userInput);

    // Show tab buttons and output area, reset both panels to fully visible
    const panelTabRow = document.getElementById('panelTabRow');
    if (panelTabRow) panelTabRow.style.display = 'flex';
    const outputRow = document.getElementById('outputRow');
    if (outputRow) outputRow.style.display = 'flex';

    // Reset both panels to visible with active buttons
    ['solutionPanel', 'plotPanel'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = '';
    });
    const sBtn = document.getElementById('solutionToggle');
    const pBtn = document.getElementById('plotToggle');
    if (sBtn) sBtn.classList.add('active');
    if (pBtn) pBtn.classList.add('active');

    updatePanelFlex();

    // Re-use mathBtn declared above

    // Check if it's a system of equations
    let partsTemp = userInput.split(';').map(p => p.trim()).filter(Boolean);
    let isSystem = partsTemp.length > 1 && partsTemp.every(p => p.includes('='));
    if (isSystem) {
        let hasDeriv = getODEOrder(partsTemp[0]) > 0;
        let allCondsValid = partsTemp.slice(1).every(p => parseInitialCondition(p) !== null);
        if (hasDeriv && allCondsValid) {
            isSystem = false;
        }
    }

    const hasLimit = userInput.toLowerCase().includes('limit(') || userInput.includes('\\lim');
    const isPureExpression = !userInput.includes('=') && (
        getODEOrder(userInput) === 0 ||
        userInput.includes('diff(') || userInput.includes('integrate(') ||
        userInput.includes('defint(') || userInput.includes('sum(') ||
        userInput.includes('product(') || userInput.includes('d/') ||
        userInput.includes('d^') ||
        /\\frac\{d[^{}]*\}\{d[^{}]*\}/.test(userInput) ||
        /\\int/.test(userInput)
    );

    if (hasLimit || isSystem || isPureExpression || (mathBtn && mathBtn.classList.contains('active'))) {
        mathSolver(userInput, rawDisplayInput);
        return;
    }

    // Convert pdiff to diff for the ODE solving pipeline
    userInput = userInput.replace(/pdiff/g, 'diff');

    if (!solId) {
        solId = document.getElementById('solution');
    }
    if (solId) {
        solId.innerHTML = '';
    }

    // Reset global step variables
    linear_P_step = '';
    linear_Q_step = '';
    linear_IF_step = '';
    linear_integ_step = '';
    bernoulli_sub_step = '';
    bernoulli_linear_step = '';
    separable_separated_step = '';
    separable_integration_step = '';
    separable_form_step = '';
    separable_sol_step = '';
    exact_M_N_step = '';
    exact_verification_step = '';
    exact_u_step = '';
    exact_form_step = '';
    exact_sol_step = '';
    const_homogeneous_lambda_step = '';
    const_homogeneous_roots_step = '';
    const_homogeneous_sol_step = '';
    const_nonhomogeneous_method_step = '';
    const_nonhomogeneous_particular_step = '';
    euler_cauchy_char_step = '';
    euler_cauchy_roots_step = '';
    euler_cauchy_sol_step = '';
    system_companion_matrix_step = '';
    system_eigenvalues_step = '';
    legendre_n_step = '';
    legendre_sol_step = '';
    bessel_v_step = '';
    bessel_sol_step = '';
    frobenius_indicial_step = '';
    frobenius_recurrence_step = '';
    frobenius_sol_step = '';
    ordinary_series_recurrence_step = '';
    ordinary_series_sol_step = '';
    initial_value_step = '';
    particular_solution_step = '';

    //Removing all spaces from string
    userInput = userInput.split('').map(item => item.trim()).join('');

    let parts = userInput.split(';').filter(Boolean);
    let odeStr = parts[0];
    let initialConds = parts.slice(1);
    let solveIVP = false;
    let parsedConds = [];
    let order = 0;

    if (parts.length > 1) {
        order = getODEOrder(odeStr);
        let numConds = initialConds.length;

        if (numConds !== order) {
            let promptInput = window.prompt(`The number of initial conditions (${numConds}) does not match the ODE order (${order}). Please enter all initial conditions separated by semicolons (e.g. "y(0)=0; y'(0)=1"), or leave empty/cancel to show the general solution:`);
            if (promptInput) {
                let promptParts = promptInput.split(';').map(p => p.trim()).filter(Boolean);
                initialConds = promptParts;
                numConds = promptParts.length;
            }
        }

        if (numConds === order) {
            parsedConds = initialConds.map(parseInitialCondition);
            if (validateInitialConditions(parsedConds, order)) {
                solveIVP = true;
            } else {
                window.alert("Invalid initial conditions format or mismatched derivative orders/evaluation points. Proceeding with general solution.");
            }
        }
    }

    userInput = odeStr;

    // Convert trig reciprocals globally
    userInput = convertTrigReciprocals(userInput);

    //Insert * between variables FIRST to ensure proper boundary detection during variable swapping
    userInput = insertImplicitStars(userInput);

    userInput = replaceNrtWithExponent(preprocessCustomRoots(userInput));

    //Check for proper differential varibales
    let dxdytermShift = xy_checkReplace(userInput);
    if (Array.isArray(dxdytermShift)) {
        userInput = dxdytermShift[0];
        xy_replaced = dxdytermShift[1];
    } else if (dxdytermShift && typeof dxdytermShift === 'object') {
        userInput = dxdytermShift.modified;
        xy_replaced = dxdytermShift.swapped;
    }

    userInput = checkFalsedx(userInput);

    //validate the parenthesis and factorize
    userInput = paranthesisValidation(userInput);

    let modified_str_eq;

    //Validation Order of ODE
    if (orderValidation(userInput) && validExpression(userInput)) {
        modified_str_eq = modify_inp(userInput);
        console.log(`order is valid, expression is valid and modified_str_eq : ${modified_str_eq}`);

        //Nerdamer differentiable string format
        let init_Diff_nerd = convToNerdamer(modified_str_eq);
        console.log(`Converted to Nerdamer differential form : ${init_Diff_nerd}`);

        let initSolved = nerdDifferentiate(init_Diff_nerd);
        console.log(`The initial differentiation gives initSolved : ${initSolved}`);
        let solvedY = dydx_To_Y1(initSolved);
        let firstODEsol = solveSingleOrder(solvedY);
        if (firstODEsol === '0' || firstODEsol === 0 || firstODEsol === 'no \\ analytical \\ solution \\ exists') {
            firstODEsol = '\\text{No analytical solution exists for this problem}';
        }

        if (firstODEsol !== '\\text{No analytical solution exists for this problem}') {
            if (solveIVP) {
                let ivpRes = solveInitValue(firstODEsol, parsedConds);
                if (ivpRes) {
                    initial_value_step = ivpRes.stepsLaTeX;
                    particular_solution_step = ivpRes.particularSolution;
                }
            }
        }

        let steps = [];
        if (firstODEsol !== '\\text{No analytical solution exists for this problem}') {
            if (linear_P_step) steps.push(linear_P_step);
            if (linear_Q_step) steps.push(linear_Q_step);
            if (linear_IF_step) steps.push(linear_IF_step);
            if (linear_integ_step) steps.push(linear_integ_step);

            if (bernoulli_sub_step) steps.push(bernoulli_sub_step);
            if (bernoulli_linear_step) steps.push(bernoulli_linear_step);

            if (separable_form_step) steps.push(separable_form_step);
            if (separable_sol_step) steps.push(separable_sol_step);
            if (separable_separated_step) steps.push(separable_separated_step);
            if (separable_integration_step) steps.push(separable_integration_step);

            if (exact_form_step) steps.push(exact_form_step);
            if (exact_sol_step) steps.push(exact_sol_step);
            if (exact_M_N_step) steps.push(exact_M_N_step);
            if (exact_verification_step) steps.push(exact_verification_step);
            if (exact_u_step) steps.push(exact_u_step);

            if (const_homogeneous_lambda_step) steps.push(const_homogeneous_lambda_step);
            if (const_homogeneous_roots_step) steps.push(const_homogeneous_roots_step);
            if (const_homogeneous_sol_step) steps.push(const_homogeneous_sol_step);
            if (const_nonhomogeneous_method_step) steps.push(const_nonhomogeneous_method_step);
            if (const_nonhomogeneous_particular_step) steps.push(const_nonhomogeneous_particular_step);

            if (euler_cauchy_char_step) steps.push(euler_cauchy_char_step);
            if (euler_cauchy_roots_step) steps.push(euler_cauchy_roots_step);
            if (euler_cauchy_sol_step) steps.push(euler_cauchy_sol_step);

            if (system_companion_matrix_step) steps.push(system_companion_matrix_step);
            if (system_eigenvalues_step) steps.push(system_eigenvalues_step);

            if (legendre_n_step) steps.push(legendre_n_step);
            if (legendre_sol_step) steps.push(legendre_sol_step);

            if (bessel_v_step) steps.push(bessel_v_step);
            if (bessel_sol_step) steps.push(bessel_sol_step);

            if (frobenius_indicial_step) steps.push(frobenius_indicial_step);
            if (frobenius_recurrence_step) steps.push(frobenius_recurrence_step);
            if (frobenius_sol_step) steps.push(frobenius_sol_step);

            if (ordinary_series_recurrence_step) steps.push(ordinary_series_recurrence_step);
            if (ordinary_series_sol_step) steps.push(ordinary_series_sol_step);

            if (particular_solution_step) {
                steps.push(`\\text{General Solution: } ` + (xy_replaced ? dxdykatexFormat(firstODEsol) : katexFormat(firstODEsol)));
            }
            if (initial_value_step) steps.push(initial_value_step);
        }

        let finalEquation = firstODEsol;
        if (particular_solution_step) {
            finalEquation = particular_solution_step;
        }

        let solution_arr;
        if (firstODEsol === '\\text{No analytical solution exists for this problem}') {
            solution_arr = [firstODEsol];
        } else {
            solution_arr = [solvedY, ...steps, finalEquation];
        }

        if (xy_replaced == true) {
            solution_arr.forEach(sol => {
                let formatted_sol;
                if (sol.startsWith('\\text{') || sol.includes('\\text{') || sol.startsWith('P(') || sol.startsWith('Q(')) {
                    formatted_sol = swapXY(simplifyFractionsInText(sol));
                } else {
                    formatted_sol = dxdykatexFormat(simplifyFractionsInText(sol));
                }
                const p = document.createElement('p');
                renderKatex(formatted_sol, p, { throwOnError: false });
                solId.appendChild(p);
            });
        }
        else {
            solution_arr.forEach(sol => {
                let formatted_sol;
                if (sol.startsWith('\\text{') || sol.includes('\\text{') || sol.startsWith('P(') || sol.startsWith('Q(')) {
                    formatted_sol = simplifyFractionsInText(sol);
                } else {
                    formatted_sol = katexFormat(simplifyFractionsInText(sol));
                }
                const p = document.createElement('p');
                renderKatex(formatted_sol, p, { throwOnError: false });
                solId.appendChild(p);
            });
        }

        // Save ODE solution to history
        let rawInputForSave = userInput;
        if (parts.length > 1) {
            rawInputForSave += ' ; ' + initialConds.join(' ; ');
        }
        let finalFormatted = "";
        if (firstODEsol === '\\text{No analytical solution exists for this problem}') {
            finalFormatted = '\\text{No analytical solution exists}';
        } else {
            let baseSol = particular_solution_step || firstODEsol;
            if (xy_replaced == true) {
                finalFormatted = dxdykatexFormat(simplifyFractionsInText(baseSol));
            } else {
                finalFormatted = katexFormat(simplifyFractionsInText(baseSol));
            }
        }
        saveSolutionToHistory(rawInputForSave, finalFormatted);

        console.log(`Seperable ODE: ${solveSingleOrder(solvedY)}`);
    }
    else {
        console.log(`Either orderValidation or validExpression Failed`);
        window.alert("Invalid Order of ODE");
        throw new Error("Invalid Order");
    }

}

function toggleToolKit() {
    const tools = document.getElementById('tools');
    if (!tools) return;

    const toolsBtn = document.querySelector('.tools-btn');
    let currentDisplay = window.getComputedStyle(tools).display;

    if (currentDisplay === 'none') {
        tools.style.display = 'flex';
        if (toolsBtn) toolsBtn.classList.add('active');
        setMode('math'); // default to MATH mode when opening toolkit

        // On mobile, if neither panel is displayed, open more-panel Page 1 by default
        if (window.innerWidth <= 600) {
            const morePanel = document.getElementById("more-panel");
            const fxPanel = document.getElementById("functions-panel");
            if (morePanel && fxPanel) {
                if (morePanel.style.display === 'none' && fxPanel.style.display === 'none') {
                    morePanel.style.display = 'flex';
                    morePanel.classList.remove('mobile-sym-page');
                    const moreBtn = document.getElementById("more-btn");
                    if (moreBtn) moreBtn.classList.remove('active');
                }
            }
        } else {
            // On desktop, display the more-panel by default to show num & op btns
            const morePanel = document.getElementById("more-panel");
            if (morePanel) {
                morePanel.style.display = 'flex';
            }
        }
    } else {
        tools.style.display = 'none';
        tools.classList.remove('wide');
        if (toolsBtn) toolsBtn.classList.remove('active');
        setMode('ode'); // default to ODE mode when closing toolkit

        // Cleanup symbols active class on desktop morePanel
        if (window.innerWidth > 600) {
            const morePanel = document.getElementById("more-panel");
            if (morePanel) {
                morePanel.classList.remove('show-symbols');
                MORE_SYMBOL_IDS.forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) btn.classList.remove('active');
                });
                showSubPanel(null);
            }
            const moreBtn = document.getElementById("more-btn");
            if (moreBtn) moreBtn.classList.remove('active');
        }
    }

    const gearIcon = document.querySelector('.tools-btn i');
    if (gearIcon) {
        gearIcon.classList.remove('gear-spin');
        void gearIcon.offsetWidth; // trigger reflow
        gearIcon.classList.add('gear-spin');
        setTimeout(() => {
            gearIcon.classList.remove('gear-spin');
        }, 600);
    }
}

function collapseToolKit() {
    const tools = document.getElementById('tools');
    if (!tools) return;

    const toolsBtn = document.querySelector('.tools-btn');
    if (toolsBtn) toolsBtn.classList.remove('active');

    tools.style.display = 'none';
    tools.classList.remove('wide');
    setMode('ode');

    // Cleanup symbols active class on desktop morePanel
    if (window.innerWidth > 600) {
        const morePanel = document.getElementById("more-panel");
        if (morePanel) {
            morePanel.classList.remove('show-symbols');
            MORE_SYMBOL_IDS.forEach(id => {
                const btn = document.getElementById(id);
                if (btn) btn.classList.remove('active');
            });
            showSubPanel(null);
        }
        const moreBtn = document.getElementById("more-btn");
        if (moreBtn) moreBtn.classList.remove('active');
    }
}

function toggleInfo() {
    const infoPanel = document.getElementById('info');
    const infoBtn = document.getElementById('info-btn');
    if (!infoPanel) return;
    if (infoPanel.style.display === 'none' || infoPanel.style.display === '') {
        infoPanel.style.display = 'block';
        if (infoBtn) infoBtn.classList.add('active');
    } else {
        infoPanel.style.display = 'none';
        if (infoBtn) infoBtn.classList.remove('active');
    }
}

const PREFIXES = [
    {
        latexRegex: /^\\int_\{([^{}]*)\}^\{([^{}]*)\} \{/,
        nerd: 'defint('
    },
    {
        latexRegex: /^\\int \{/,
        nerd: 'integrate('
    },
    {
        latexRegex: /^\\frac\{d\^\{([^{}]*)\}\}\{dx\^\{([^{}]*)\}\} \{/,
        nerd: 'diff('
    },
    {
        latexRegex: /^\\frac\{d\}\{dx\} \{/,
        nerd: 'diff('
    },
    {
        latexRegex: /^\\lim_\{x \\to, ([^{}]*)\}/,
        nerd: 'limit('
    },
    {
        latexRegex: /^\\sum_\{([^{}]*)\}^\{([^{}]*)\} \{/,
        nerd: 'sum('
    },
    {
        latexRegex: /^\\prod_\{([^{}]*)\}^\{([^{}]*)\} \{/,
        nerd: 'product('
    },
    {
        latexRegex: /^\\sqrt\[([^[\]]*)\]\{/,
        nerd: 'nrt('
    },
    {
        latexRegex: /^\\sqrt\{/,
        nerd: 'sqrt('
    },
    {
        latexRegex: /^\\lvert \{/,
        nerd: 'abs('
    },
    {
        latexRegex: /^\\\[\{/,
        nerd: 'fact('
    },
    {
        latexRegex: /^\\frac\{/,
        nerd: '('
    },
    {
        latexRegex: /^\\sin\^\{-1\}\{/,
        nerd: 'asin('
    },
    {
        latexRegex: /^\\cos\^\{-1\}\{/,
        nerd: 'acos('
    },
    {
        latexRegex: /^\\tan\^\{-1\}\{/,
        nerd: 'atan('
    },
    {
        latexRegex: /^\\sinh\{/,
        nerd: 'sinh('
    },
    {
        latexRegex: /^\\cosh\{/,
        nerd: 'cosh('
    },
    {
        latexRegex: /^\\tanh\{/,
        nerd: 'tanh('
    },
    {
        latexRegex: /^\\sin\{/,
        nerd: 'sin('
    },
    {
        latexRegex: /^\\cos\{/,
        nerd: 'cos('
    },
    {
        latexRegex: /^\\tan\{/,
        nerd: 'tan('
    },
    {
        latexRegex: /^\\ln\{/,
        nerd: 'ln('
    },
    {
        latexRegex: /^\\log\{/,
        nerd: 'log('
    },
    {
        latexRegex: /^\\exp\{/,
        nerd: 'exp('
    }
];

const DELIMITERS = [
    { latex: '}\\, dx', nerd: ', x)' },
    { latex: '}^{} {}\\, dx', nerd: ', a, b, x)' },
    { latex: '^{} {}\\, dx', nerd: ', a, b, x)' },
    { latex: '}', nerd: ')' },
    { latex: '!', nerd: ')' },
    { latex: ' \\rvert', nerd: ')' },
    { latex: '\\]', nerd: ')' },
    { latex: '}{', nerd: ')/(' },
];

function mapMathCursorToOde(mathVal, odeVal, mathCursor) {
    if (mathCursor <= 0) return 0;
    if (mathCursor >= mathVal.length) return odeVal.length;

    let m = 0;
    let o = 0;

    while (m < mathVal.length && o < odeVal.length) {
        if (m >= mathCursor) {
            return o;
        }

        let matched = false;
        for (const p of PREFIXES) {
            let match = mathVal.substring(m).match(p.latexRegex);
            if (match) {
                m += match[0].length;
                o += p.nerd.length;
                matched = true;
                break;
            }
        }
        if (matched) continue;

        for (const d of DELIMITERS) {
            if (mathVal.startsWith(d.latex, m) && odeVal.startsWith(d.nerd, o)) {
                m += d.latex.length;
                o += d.nerd.length;
                matched = true;
                break;
            }
        }
        if (matched) continue;

        m++;
        o++;
    }

    return o;
}

function mapOdeCursorToMath(odeVal, mathVal, odeCursor) {
    if (odeCursor <= 0) return 0;
    if (odeCursor >= odeVal.length) return mathVal.length;

    let m = 0;
    let o = 0;

    while (m < mathVal.length && o < odeVal.length) {
        if (o >= odeCursor) {
            return m;
        }

        let matched = false;
        for (const p of PREFIXES) {
            let match = mathVal.substring(m).match(p.latexRegex);
            if (match) {
                m += match[0].length;
                o += p.nerd.length;
                matched = true;
                break;
            }
        }
        if (matched) continue;

        for (const d of DELIMITERS) {
            if (mathVal.startsWith(d.latex, m) && odeVal.startsWith(d.nerd, o)) {
                m += d.latex.length;
                o += d.nerd.length;
                matched = true;
                break;
            }
        }
        if (matched) continue;

        m++;
        o++;
    }

    return m;
}

function getSafeCursor(val, pos) {
    if (pos <= 0 || pos >= val.length) return pos;

    let back = pos - 1;
    while (back >= 0 && /[a-zA-Z]/.test(val[back])) {
        back--;
    }
    if (back >= 0 && val[back] === '\\') {
        let forward = pos;
        while (forward < val.length && /[a-zA-Z]/.test(val[forward])) {
            forward++;
        }
        return forward;
    }
    return pos;
}

function syncSelectionToOde() {
    const math = document.getElementById("math");
    const ode = document.getElementById("ode");
    if (!math || !ode) return;

    const mathStart = math.selectionStart;
    const mathEnd = math.selectionEnd;

    const odeStart = mapMathCursorToOde(math.value, ode.value, mathStart);
    const odeEnd = mapMathCursorToOde(math.value, ode.value, mathEnd);

    ode.setSelectionRange(odeStart, odeEnd);
}

function syncSelectionToMath() {
    const math = document.getElementById("math");
    const ode = document.getElementById("ode");
    if (!math || !ode) return;

    const odeStart = ode.selectionStart;
    const odeEnd = ode.selectionEnd;

    const mathStart = mapOdeCursorToMath(ode.value, math.value, odeStart);
    const mathEnd = mapOdeCursorToMath(ode.value, math.value, odeEnd);

    math.setSelectionRange(mathStart, mathEnd);
}

function escapeLatexOverlay(str) {
    if (!str) return "";
    let res = "";
    for (let i = 0; i < str.length; i++) {
        let c = str[i];
        if (c === '#') {
            res += '\\#';
        } else if (c === '$') {
            res += '\\$';
        } else if (c === '%') {
            res += '\\%';
        } else if (c === '*') {
            res += '\\cdot ';
        } else if (c === '\\') {
            let next = str[i + 1];
            if (next && (/[a-zA-Z]/.test(next) || next === ',' || next === ' ' || next === '{' || next === '}' || next === '_' || next === '^' || next === '[' || next === ']' || next === '\\' || next === '#' || next === '$' || next === '&' || next === '%')) {
                res += '\\';
            } else {
                res += '\\backslash ';
            }
        } else if (c === ' ') {
            if (i > 0 && str[i - 1] === '\\') {
                res += ' ';
            } else {
                let nextChar = str[i + 1];
                if (nextChar === '{') {
                    res += ' ';
                } else {
                    res += '\\ ';
                }
            }
        } else if (c === '_') {
            if (str[i + 1] === '{' || (i > 0 && str[i - 1] === '\\')) {
                res += '_';
            } else {
                res += '\\_';
            }
        } else {
            res += c;
        }
    }
    return res;
}

function updateMathOverlay() {
    const math = document.getElementById("math");
    const overlay = document.getElementById("ode-math-overlay");
    if (!math || !overlay) return;

    let val = math.value;
    let pos = math.selectionStart;

    let safePos = getSafeCursor(val, pos);

    let left = val.substring(0, safePos);
    let right = val.substring(safePos);

    // ── Keyword → LaTeX symbol substitutions ──
    // Applied to left/right AFTER cursor split so cursor position is preserved.
    // ilaplace first (contains 'laplace' as substring).
    // No negative lookahead needed: laplace( renders as ℒ( which is fine.
    function applyKwSubs(s) {
        s = s.replace(/\bilaplace\b/g, '\\mathcal{L}^{-1}');
        s = s.replace(/\blaplace\b/g, '\\mathcal{L}');
        return s;
    }
    left = applyKwSubs(left);
    right = applyKwSubs(right);

    let escapedLeft = escapeLatexOverlay(left);
    let escapedRight = escapeLatexOverlay(right);

    let latexWithCaret = escapedLeft + "\\htmlClass{math-caret}{|}" + escapedRight;
    let escapedVal = escapeLatexOverlay(left + right);

    function renderOverlayContent(caretLatex, valLatex, rawText, container) {
        container.innerHTML = '';
        const caretLines = caretLatex.split('\n');
        const valLines = valLatex.split('\n');
        const rawLines = rawText.split('\n');

        caretLines.forEach((line, index) => {
            const lineDiv = document.createElement('div');
            lineDiv.className = 'math-overlay-line';
            container.appendChild(lineDiv);

            let rendered = false;
            try {
                let content = line;
                if (content.trim() === '') {
                    content = '\\text{}';
                }
                renderKatex(content, lineDiv, {
                    throwOnError: true,
                    trust: true
                });
                rendered = true;
            } catch (e) {
                try {
                    let content = valLines[index] || '';
                    if (content.trim() === '') {
                        content = '\\text{}';
                    }
                    renderKatex(content, lineDiv, {
                        throwOnError: true,
                        trust: true
                    });
                    rendered = true;
                } catch (e2) {
                    // fallback to raw text
                }
            }

            if (!rendered) {
                lineDiv.textContent = rawLines[index] || '';
            }
        });
    }

    if (typeof window !== 'undefined' && window.mathSolverLastSolution) {
        overlay.classList.add('has-solution');
        overlay.innerHTML = '<div class="overlay-input"></div><div class="overlay-solution"></div>';
        const inputDiv = overlay.querySelector('.overlay-input');
        const solutionDiv = overlay.querySelector('.overlay-solution');

        renderOverlayContent(latexWithCaret, escapedVal, val, inputDiv);

        try {
            renderKatex(`\\color{#00a994}{\\implies ${window.mathSolverLastSolution}}`, solutionDiv, {
                throwOnError: true,
                trust: true
            });
        } catch (e) {
            solutionDiv.textContent = `=> ${window.mathSolverLastSolution}`;
        }
    } else {
        overlay.classList.remove('has-solution');
        renderOverlayContent(latexWithCaret, escapedVal, val, overlay);
    }

    // Defer width, height, and scroll measurements to requestAnimationFrame
    // to ensure the browser has completed layout on the newly rendered KaTeX DOM nodes.
    const rAF = (typeof requestAnimationFrame !== 'undefined') ? requestAnimationFrame : (cb) => setTimeout(cb, 0);
    rAF(() => {
        const mathEl = document.getElementById("math");
        const overlayEl = document.getElementById("ode-math-overlay");
        const odeEl = document.getElementById("ode");
        const isMobile = window.innerWidth <= 600;

        if (mathEl && overlayEl) {
            let isVisibleEl = window.getComputedStyle(overlayEl).display !== 'none';
            if (isVisibleEl) {
                // Force synchronous browser layout reflow to guarantee precise KaTeX node dimensions
                overlayEl.offsetHeight;

                if (mathEl.value === '') {
                    if (!isMobile) {
                        mathEl.style.width = '400px';
                        const container = mathEl.closest('.ode-input-container');
                        if (container) container.style.width = '400px';
                        if (odeEl) odeEl.style.width = '400px';
                        overlayEl.style.width = '396px';
                    } else {
                        mathEl.style.width = '';
                        const container = mathEl.closest('.ode-input-container');
                        if (container) container.style.width = '';
                        if (odeEl) odeEl.style.width = '';
                        overlayEl.style.width = '';
                    }

                    let defaultHeight = isMobile ? '44px' : '60px';
                    mathEl.style.height = defaultHeight;
                    overlayEl.style.height = `calc(${defaultHeight} - 4px)`;
                    if (odeEl) odeEl.style.height = defaultHeight;
                } else {
                    if (!isMobile) {
                        const katexEls = overlayEl.querySelectorAll('.katex-html, .katex');
                        let contentW = 0;
                        if (katexEls.length > 0) {
                            katexEls.forEach(el => {
                                let w = el.scrollWidth || el.getBoundingClientRect().width;
                                if (w > contentW) contentW = w;
                            });
                        } else {
                            contentW = overlayEl.scrollWidth - 20;
                        }
                        let maxAllowedW = window.innerWidth - 120;
                        let newWidth = Math.max(400, Math.ceil(contentW + 34));
                        const currentW = parseFloat(mathEl.style.width) || 400;
                        newWidth = Math.max(newWidth, currentW);
                        newWidth = Math.min(newWidth, maxAllowedW);
                        let finalWidth = newWidth + 'px';

                        if (mathEl.style.width !== finalWidth) {
                            mathEl.style.width = finalWidth;
                            const container = mathEl.closest('.ode-input-container');
                            if (container) container.style.width = finalWidth;
                            if (odeEl) odeEl.style.width = finalWidth;
                            overlayEl.style.width = `calc(${finalWidth} - 4px)`;
                        }
                    } else {
                        mathEl.style.width = '';
                        const container = mathEl.closest('.ode-input-container');
                        if (container) container.style.width = '';
                        if (odeEl) odeEl.style.width = '';
                        overlayEl.style.width = '';
                    }

                    // Height adjustment: Measure rendered KaTeX content height accurately.
                    let contentH = 0;

                    const inputDiv = overlayEl.querySelector('.overlay-input');
                    const solutionDiv = overlayEl.querySelector('.overlay-solution');
                    if (inputDiv && solutionDiv) {
                        contentH = inputDiv.scrollHeight + solutionDiv.scrollHeight + 12;
                    } else {
                        const measureDiv = document.createElement('div');
                        const overlayComputed = window.getComputedStyle(overlayEl);
                        let measureWidth = isMobile ? overlayEl.getBoundingClientRect().width : overlayEl.clientWidth;
                        if (measureWidth <= 0) {
                            measureWidth = window.innerWidth - 80;
                        }
                        measureDiv.style.cssText = [
                            'position:absolute',
                            'top:0',
                            'left:-9999px',
                            'visibility:hidden',
                            'height:auto',
                            'width:' + measureWidth + 'px',
                            'overflow:visible',
                            'font-size:' + overlayComputed.fontSize,
                            'font-family:' + overlayComputed.fontFamily,
                            'line-height:' + overlayComputed.lineHeight,
                        ].join(';');

                        document.body.appendChild(measureDiv);
                        const clonedNode = overlayEl.cloneNode(true);
                        clonedNode.style.height = 'auto';
                        clonedNode.style.display = 'block';
                        measureDiv.appendChild(clonedNode);
                        void measureDiv.offsetHeight;
                        contentH = clonedNode.scrollHeight || measureDiv.offsetHeight || 0;
                        document.body.removeChild(measureDiv);
                    }

                    const computedStyle = window.getComputedStyle(mathEl);
                    const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
                    const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;
                    const borderTop = parseFloat(computedStyle.borderTopWidth) || 0;
                    const borderBottom = parseFloat(computedStyle.borderBottomWidth) || 0;
                    const extraH = paddingTop + paddingBottom + borderTop + borderBottom;
                    const hasMatrix = mathEl.value.includes('matrix') || mathEl.value.includes('begin') ||
                        (typeof window !== 'undefined' && window.mathSolverLastSolution && (window.mathSolverLastSolution.includes('matrix') || window.mathSolverLastSolution.includes('begin')));
                    let bufferH = hasMatrix ? 28 : 8;
                    if (typeof window !== 'undefined' && window.mathSolverLastSolution) {
                        bufferH += 18;
                    }
                    let scrollbarBuffer = 0;
                    if (overlayEl && overlayEl.scrollWidth > overlayEl.clientWidth + 5) {
                        scrollbarBuffer = 18;
                    }

                    let minHeight = isMobile ? 44 : 60;
                    let fitHeight = Math.max(minHeight, Math.ceil(contentH + extraH + bufferH + scrollbarBuffer));
                    if (isMobile) {
                        fitHeight = Math.min(150, fitHeight);
                    }

                    if (mathEl.style.height !== fitHeight + 'px') {
                        mathEl.style.height = fitHeight + 'px';
                        overlayEl.style.height = `calc(${fitHeight}px - 4px)`;
                        if (odeEl) odeEl.style.height = fitHeight + 'px';
                    }
                }
            }
        }

        // Check for overflow to display/hide the scroll indicator dot
        const indicator = document.getElementById("ode-scroll-indicator");
        if (indicator && overlayEl) {
            let isVisibleEl = window.getComputedStyle(overlayEl).display !== 'none';
            if (isVisibleEl && overlayEl.scrollWidth > overlayEl.clientWidth + 5) {
                indicator.style.display = 'block';
            } else {
                indicator.style.display = 'none';
            }
        }
    });
}

/**
 * Converts matrix(A) * matrix(B) → multiply(matrix(A), matrix(B)) in a nerdamer expression
 * string. Handles chained multiplications left-associatively.
 * vector(...) operands are also wrapped since row/col vectors participate in matrix products.
 */
function wrapMatrixMultiplication(str) {
    // Repeatedly scan for (matrix|vector|multiply)(...) * (matrix|vector)(...) and wrap.
    // The outer while loop keeps going until no more replacements are made (handles A*B*C chains).
    const leftRe = /(?:matrix|vector|multiply)\(/;
    const rightRe = /^(?:matrix|vector)\(/;
    let changed = true;
    while (changed) {
        changed = false;
        let idx = 0;
        while (idx < str.length) {
            let mMatch = str.slice(idx).match(leftRe);
            if (!mMatch) break;
            let mStart = idx + mMatch.index;
            let mFnEnd = mStart + mMatch[0].length;

            // Walk to matching ')'
            let depth = 1, j = mFnEnd;
            while (j < str.length && depth > 0) {
                if (str[j] === '(') depth++;
                else if (str[j] === ')') depth--;
                j++;
            }
            if (depth !== 0) break;
            let mEnd = j;

            // Skip spaces
            let afterM = mEnd;
            while (afterM < str.length && str[afterM] === ' ') afterM++;

            // Must be followed by *
            if (str[afterM] !== '*') { idx = mEnd; continue; }
            let afterStar = afterM + 1;
            while (afterStar < str.length && str[afterStar] === ' ') afterStar++;

            // Right operand must start with matrix( or vector(
            let nMatch = str.slice(afterStar).match(rightRe);
            if (!nMatch) { idx = mEnd; continue; }

            let nStart = afterStar;
            let nFnEnd = nStart + nMatch[0].length;
            depth = 1; j = nFnEnd;
            while (j < str.length && depth > 0) {
                if (str[j] === '(') depth++;
                else if (str[j] === ')') depth--;
                j++;
            }
            if (depth !== 0) break;
            let nEnd = j;

            let A = str.slice(mStart, mEnd);
            let B = str.slice(nStart, nEnd);
            str = str.slice(0, mStart) + `multiply(${A}, ${B})` + str.slice(nEnd);
            changed = true;
            idx = mStart; // restart from same position for chained ops
        }
    }
    return str;
}

function stripVecArrows(latex) {
    if (!latex) return "";
    let idx = latex.indexOf('\\vec{');
    while (idx !== -1) {
        let depth = 1;
        let j = idx + 5;
        while (j < latex.length && depth > 0) {
            if (latex[j] === '{') depth++;
            else if (latex[j] === '}') depth--;
            j++;
        }
        if (depth === 0) {
            let content = latex.substring(idx + 5, j - 1);
            latex = latex.substring(0, idx) + content + latex.substring(j);
            idx = latex.indexOf('\\vec{', idx);
        } else {
            break;
        }
    }
    return latex;
}

function convertUnitVectorsToVector(latex) {
    if (!latex) return "";
    const vectorGroupRegex = /\[?\s*(?:[+-]?\s*(?:[a-zA-Z0-9./]*)\s*\\hat\{[ijk]\}\s*)+\s*\]?/g;

    return latex.replace(vectorGroupRegex, (match) => {
        if (!match.includes('\\hat{')) return match;

        let x = [], y = [], z = [];
        const termRegex = /([+-]?)\s*([a-zA-Z0-9./]*)\s*\\hat\{([ijk])\}/g;
        let termMatch;
        let matchedAny = false;

        while ((termMatch = termRegex.exec(match)) !== null) {
            matchedAny = true;
            let sign = termMatch[1].trim();
            if (sign === '') sign = '+';
            let coeff = termMatch[2].trim();
            if (coeff === '') coeff = '1';
            let fullCoeff = (sign === '-' ? '-' : '+') + coeff;
            let unit = termMatch[3];

            if (unit === 'i') x.push(fullCoeff);
            else if (unit === 'j') y.push(fullCoeff);
            else if (unit === 'k') z.push(fullCoeff);
        }

        if (matchedAny) {
            let xStr = x.length > 0 ? x.join('') : '0';
            let yStr = y.length > 0 ? y.join('') : '0';
            let zStr = z.length > 0 ? z.join('') : '0';
            if (xStr.startsWith('+')) xStr = xStr.substring(1);
            if (yStr.startsWith('+')) yStr = yStr.substring(1);
            if (zStr.startsWith('+')) zStr = zStr.substring(1);
            return ` vector(${xStr},${yStr},${zStr}) `;
        }
        return match;
    });
}

function convertLatexMatrixToNerdamer(latex) {
    let regex = /\\begin\{(bmatrix|vmatrix|matrix)\}([\s\S]*?)\\end\{\1\}/g;

    return latex.replace(regex, (match, type, content) => {
        let rows = content.split(/\\\\|\\cr/);
        let cleanRows = rows.map(r => r.trim()).filter(Boolean);

        if (cleanRows.length === 1 && type === 'bmatrix') {
            let cols = cleanRows[0].split('&').map(c => {
                let val = c.trim();
                return translateLatexToNerdamer(val);
            });
            return ` vector(${cols.join(',')}) `;
        }

        let nerdRows = [];
        for (let row of cleanRows) {
            let cols = row.split('&').map(c => {
                let val = c.trim();
                return translateLatexToNerdamer(val);
            });
            nerdRows.push(`[${cols.join(',')}]`);
        }

        let nerdMatrix = ` matrix(${nerdRows.join(',')}) `;
        if (type === 'vmatrix') {
            return ` determinant(${nerdMatrix}) `;
        }
        return nerdMatrix;
    });
}

function translateLatexToNerdamer(latex) {
    if (!latex) return "";

    // Protect double backslashes from being stripped
    latex = latex.replace(/\\\\/g, '@@DBLSLASH@@');
    latex = latex.replace(/\\\,/g, '').replace(/\\ /g, ' ');
    latex = latex.replace(/@@DBLSLASH@@/g, '\\\\');

    latex = stripVecArrows(latex);
    latex = convertUnitVectorsToVector(latex);

    // Remove \left( and \right) to prevent "left" and "right" function call conflicts
    latex = latex.replace(/\\left\(/g, '(').replace(/\\right\)/g, ')');

    // Preprocess dot products: A \cdot B -> \text{dot}(A, B)
    latex = latex.replace(/((?:\(?\s*(?:\\vec\{[^{}]+\}|vector\([^)]+\)|\\begin\{(?:bmatrix|matrix|vmatrix)\}[\s\S]*?\\end\{(?:bmatrix|matrix|vmatrix)\}|[a-zA-Z0-9]+)\s*\)?\s*))\s*\\cdot\s*((?:\(?\s*(?:\\vec\{[^{}]+\}|vector\([^)]+\)|\\begin\{(?:bmatrix|matrix|vmatrix)\}[\s\S]*?\\end\{(?:bmatrix|matrix|vmatrix)\}|[a-zA-Z0-9]+)\s*\)?\s*))/g, '\\text{dot}($1,$2)');

    // Preprocess cross products: A \times B -> \text{cross}(A, B)
    latex = latex.replace(/((?:\(?\s*(?:\\vec\{[^{}]+\}|vector\([^)]+\)|\\begin\{(?:bmatrix|matrix|vmatrix)\}[\s\S]*?\\end\{(?:bmatrix|matrix|vmatrix)\}|[a-zA-Z0-9]+)\s*\)?\s*))\s*\\times\s*((?:\(?\s*(?:\\vec\{[^{}]+\}|vector\([^)]+\)|\\begin\{(?:bmatrix|matrix|vmatrix)\}[\s\S]*?\\end\{(?:bmatrix|matrix|vmatrix)\}|[a-zA-Z0-9]+)\s*\)?\s*))/g, '\\text{cross}($1,$2)');

    // Strip \vec arrow so variables/values are computed normally
    latex = latex.replace(/\\vec\{([^{}]+)\}/g, '$1');

    // Preprocess Laplace and Inverse Laplace
    latex = latex.replace(/\\mathcal\{L\}\^\{?-1\}?\\left\\{([\s\S]*?)\\right\\}\((.*?)\)/g, 'ilaplace($1, $2, t)');
    latex = latex.replace(/\\mathcal\{L\}\^\{?-1\}?\{([\s\S]*?)\}\((.*?)\)/g, 'ilaplace($1, $2, t)');
    latex = latex.replace(/\\mathcal\{L\}\^\{?-1\}?\\left\\{([\s\S]*?)\\right\\}/g, 'ilaplace($1, s, t)');
    latex = latex.replace(/\\mathcal\{L\}\^\{?-1\}?\{([\s\S]*?)\}/g, 'ilaplace($1, s, t)');

    latex = latex.replace(/\\mathcal\{L\}\\left\\{([\s\S]*?)\\right\\}\((.*?)\)/g, 'laplace($1, t, $2)');
    latex = latex.replace(/\\mathcal\{L\}\{([\s\S]*?)\}\((.*?)\)/g, 'laplace($1, t, $2)');
    latex = latex.replace(/\\mathcal\{L\}\\left\\{([\s\S]*?)\\right\\}/g, 'laplace($1, t, s)');
    latex = latex.replace(/\\mathcal\{L\}\{([\s\S]*?)\}/g, 'laplace($1, t, s)');

    // Preprocess transpose: \begin{bmatrix}...\end{bmatrix}^T or ^{T} -> \text{transpose}(\begin{bmatrix}...\end{bmatrix})
    latex = latex.replace(/(\\begin\{(bmatrix|vmatrix|matrix)\}[\s\S]*?\\end\{\2\})\s*\^\s*\{?\s*[Tt]\s*\}?/g, '\\text{transpose}($1)');

    // Preprocess inverse: \begin{bmatrix}...\end{bmatrix}^{-1} or ^-1 -> \text{invert}(\begin{bmatrix}...\end{bmatrix})
    latex = latex.replace(/(\\begin\{(bmatrix|vmatrix|matrix)\}[\s\S]*?\\end\{\2\})\s*\^\s*\{?\s*-1\s*\}?/g, '\\text{invert}($1)');

    // Convert matrix/vmatrix LaTeX structures to matrix/vector format
    latex = convertLatexMatrixToNerdamer(latex);

    // Convert matrix(A) * matrix(B) → multiply(matrix(A), matrix(B)) for true matrix multiplication.
    // Nerdamer's * on matrices is element-wise; multiply() is the correct matrix product.
    latex = wrapMatrixMultiplication(latex);

    // Replace LaTeX inequality and approximation relations with standard '=' for calculations
    latex = latex.replace(/\\le\b/g, '=')
        .replace(/\\leq\b/g, '=')
        .replace(/\\ge\b/g, '=')
        .replace(/\\geq\b/g, '=')
        .replace(/\\approx\b/g, '=');

    let pos = 0;

    function skipSpaces() {
        while (pos < latex.length && (latex[pos] === ' ' || latex[pos] === '\t')) {
            pos++;
        }
    }

    function parse() {
        let res = "";
        while (pos < latex.length) {
            let char = latex[pos];

            if (char === '\\') {
                let cmd = "";
                pos++;
                while (pos < latex.length && /[a-zA-Z]/.test(latex[pos])) {
                    cmd += latex[pos];
                    pos++;
                }

                skipSpaces();
                if (cmd === 'int') {
                    let lower = "";
                    let upper = "";
                    if (pos < latex.length && latex[pos] === '_') {
                        pos++;
                        lower = parseGroup();
                    }
                    skipSpaces();
                    if (pos < latex.length && latex[pos] === '^') {
                        pos++;
                        upper = parseGroup();
                    }
                    skipSpaces();
                    let expr = parseGroupOrUntilDx();

                    if (lower || upper) {
                        res += `defint(${expr}, ${lower || '0'}, ${upper || '1'}, x)`;
                    } else {
                        res += `integrate(${expr}, x)`;
                    }
                    consumeDx();
                }
                else if (cmd === 'frac') {
                    let num = parseGroup();
                    let den = parseGroup();

                    let isDeriv = false;
                    let order = "";
                    let wrt = "x";
                    let expr = "";

                    let cleanNum = num.replace(/\s+/g, '');
                    let cleanDen = den.replace(/\s+/g, '');

                    let numMatch = cleanNum.match(/^(d|partial)(?:\^(?:\{([^}]+)\}|(.)))?(.*)$/);
                    let denMatch = cleanDen.match(/^(?:d|partial)(?:\^(?:\{([^}]+)\}|(.)))?([a-zA-Z])(?:\^(?:\{([^}]+)\}|(.)))?$/);

                    if (numMatch && denMatch) {
                        isDeriv = true;
                        wrt = denMatch[3];
                        let numOrder = numMatch[2] || numMatch[3] || "";
                        let denOrder = denMatch[1] || denMatch[2] || denMatch[4] || denMatch[5] || "";
                        order = numOrder || denOrder || "1";
                        let remaining = numMatch[4];
                        if (remaining) {
                            if (remaining.startsWith('{') && remaining.endsWith('}')) {
                                expr = translateLatexToNerdamer(remaining.slice(1, -1));
                            } else {
                                expr = translateLatexToNerdamer(remaining);
                            }
                        } else {
                            expr = parseGroup();
                        }
                    }

                    if (isDeriv) {
                        let isPartial = cleanNum.startsWith('partial') || cleanDen.startsWith('partial');
                        let diffCmd = isPartial ? 'pdiff' : 'diff';
                        let isOdeMode = false;
                        if (typeof document !== 'undefined') {
                            const odeBtn = document.getElementById('mode-ode');
                            if (odeBtn && odeBtn.classList.contains('active')) {
                                isOdeMode = true;
                            }
                        }
                        if (isOdeMode) {
                            if (order === "1") {
                                res += `d${expr}/d${wrt}`;
                            } else {
                                res += `d^${order}${expr}/d${wrt}^${order}`;
                            }
                        } else {
                            if (order === "1") {
                                res += `${diffCmd}(${expr}, ${wrt})`;
                            } else {
                                res += `${diffCmd}(${expr}, ${wrt}, ${order})`;
                            }
                        }
                    } else {
                        res += `(${num})/(${den})`;
                    }
                }
                else if (cmd === 'sum' || cmd === 'prod') {
                    let lower = "";
                    let upper = "";
                    if (pos < latex.length && latex[pos] === '_') {
                        pos++;
                        lower = parseGroup();
                    }
                    skipSpaces();
                    if (pos < latex.length && latex[pos] === '^') {
                        pos++;
                        upper = parseGroup();
                    }
                    skipSpaces();
                    let expr = parseGroup();
                    let varName = "x";
                    let lowerVal = lower;
                    if (lower.includes('=')) {
                        varName = lower.split('=')[0].trim();
                        lowerVal = lower.split('=')[1].trim();
                    }
                    let nerdCmd = cmd === 'sum' ? 'sum' : 'product';
                    res += `${nerdCmd}(${expr}, ${varName}, ${lowerVal || '1'}, ${upper || '10'})`;
                }
                else if (cmd === 'lim') {
                    let cond = "";
                    if (pos < latex.length && latex[pos] === '_') {
                        pos++;
                        cond = parseGroup();
                    }
                    skipSpaces();
                    let expr = parseGroup();
                    let varName = "x";
                    let target = "0";
                    cond = cond.replace(/\\to/g, '->');
                    if (cond.includes('->')) {
                        varName = cond.split('->')[0].trim();
                        target = cond.split('->')[1].trim();
                    }
                    res += `limit(${expr}, ${varName}, ${target})`;
                }
                else if (cmd === 'sqrt') {
                    let opt = "";
                    if (pos < latex.length && latex[pos] === '[') {
                        pos++;
                        opt = parseUntil(']');
                    }
                    skipSpaces();
                    let expr = parseGroup();
                    if (opt) {
                        res += `nrt(${expr}, ${opt})`;
                    } else {
                        res += `sqrt(${expr})`;
                    }
                }
                else if (cmd === 'lvert') {
                    // Parse until matching \rvert, keeping track of nested \lvert / \rvert
                    let start = pos;
                    let depth = 1;
                    while (pos < latex.length && depth > 0) {
                        if (latex.substring(pos).startsWith('\\lvert')) {
                            depth++;
                            pos += 6;
                        } else if (latex.substring(pos).startsWith('\\rvert')) {
                            depth--;
                            if (depth === 0) {
                                break;
                            }
                            pos += 6;
                        } else {
                            pos++;
                        }
                    }
                    let innerLatex = latex.substring(start, pos);
                    if (pos < latex.length && latex.substring(pos).startsWith('\\rvert')) {
                        pos += 6;
                    }
                    let expr = translateLatexToNerdamer(innerLatex);
                    res += `abs(${expr})`;
                }
                else if (cmd === 'log' && pos < latex.length && latex[pos] === '_') {
                    pos++;
                    let base = parseGroup();
                    skipSpaces();
                    let expr = parseGroup();
                    res += `log(${expr}, ${base})`;
                }
                else if (cmd === 'sin' || cmd === 'cos' || cmd === 'tan' ||
                    cmd === 'sinh' || cmd === 'cosh' || cmd === 'tanh' ||
                    cmd === 'ln' || cmd === 'log' || cmd === 'exp' ||
                    cmd === 'sec' || cmd === 'csc' || cmd === 'cosec' || cmd === 'cot' ||
                    cmd === 'sech' || cmd === 'csch' || cmd === 'cosech' || cmd === 'coth' ||
                    cmd === 'asec' || cmd === 'acsc' || cmd === 'acosec' || cmd === 'acot') {
                    skipSpaces();
                    if (pos + 1 < latex.length && latex[pos] === '{' && latex[pos + 1] === '}') {
                        pos += 2;
                    }
                    skipSpaces();
                    let isInv = false;
                    let power = "";
                    if (pos < latex.length && latex[pos] === '^') {
                        pos++;
                        power = parseGroup();
                        if (power === '-1') {
                            isInv = true;
                        }
                    }
                    skipSpaces();
                    let expr = parseGroup();
                    let funcName = cmd;
                    if (funcName === 'cosec') funcName = 'csc';
                    if (funcName === 'cosech') funcName = 'csch';
                    if (funcName === 'acosec') funcName = 'acsc';
                    if (isInv) {
                        if (cmd === 'sin') funcName = 'asin';
                        else if (cmd === 'cos') funcName = 'acos';
                        else if (cmd === 'tan') funcName = 'atan';
                        else if (cmd === 'sec') funcName = 'asec';
                        else if (cmd === 'csc' || cmd === 'cosec') funcName = 'acsc';
                        else if (cmd === 'cot') funcName = 'acot';
                        res += `${funcName}(${expr})`;
                    } else if (power) {
                        res += `(${funcName}(${expr}))^(${power})`;
                    } else {
                        res += `${funcName}(${expr})`;
                    }
                }
                else if (cmd === 'htmlClass') {
                    let className = parseGroup();
                    let content = parseGroup();
                    res += content;
                }
                else if (cmd === 'text') {
                    res += parseGroup();
                }
                else if (cmd === 'cdot' || cmd === 'times') {
                    res += '*';
                }
                else {
                    if (cmd === 'infty') {
                        res += 'Infinity';
                    } else {
                        res += cmd;
                    }
                }
            }
            else if (char === '{') {
                pos++;
                res += parse();
                if (pos < latex.length && latex[pos] === '}') {
                    pos++;
                }
            }
            else if (char === '}') {
                return res;
            }
            else if (char === '^') {
                pos++;
                let exponent = parseGroup();
                let cleanExp = exponent.trim();
                if (cleanExp !== "" && cleanExp !== "_") {
                    if (cleanExp.length === 1) {
                        res += `^${cleanExp}`;
                    } else {
                        res += `^(${cleanExp})`;
                    }
                }
            }
            else if (char === '_' && pos + 1 < latex.length && latex[pos + 1] !== '}' && latex[pos + 1] !== ']' && latex[pos + 1] !== ')') {
                pos++;
                let subscript = parseGroup();
                let cleanSub = subscript.trim();
                if (cleanSub !== "" && cleanSub !== "_") {
                    if (cleanSub.length === 1) {
                        res += `_${cleanSub}`;
                    } else {
                        res += `_(${cleanSub})`;
                    }
                }
            }
            else {
                res += char;
                pos++;
            }
        }
        return res;
    }

    function consumeDx() {
        skipSpaces();
        if (latex.substring(pos).startsWith('\\text{d}')) {
            pos += 8;
            skipSpaces();
            if (pos < latex.length && /[a-zA-Z]/.test(latex[pos])) {
                pos++;
            }
        }
        else if (latex.substring(pos).startsWith('d')) {
            if (pos + 1 < latex.length && /[a-zA-Z]/.test(latex[pos + 1])) {
                pos += 2;
            }
        }
    }

    function parseGroup() {
        skipSpaces();
        if (pos < latex.length && latex[pos] === '{') {
            pos++;
            let val = parse();
            if (pos < latex.length && latex[pos] === '}') {
                pos++;
            }
            return val;
        }
        if (pos < latex.length && latex[pos] === '(') {
            let start = pos;
            let depth = 0;
            while (pos < latex.length) {
                if (latex[pos] === '(') {
                    depth++;
                } else if (latex[pos] === ')') {
                    depth--;
                    if (depth === 0) {
                        pos++;
                        break;
                    }
                }
                pos++;
            }
            let inner = latex.substring(start + 1, pos - 1);
            return translateLatexToNerdamer(inner);
        }
        if (pos < latex.length) {
            let start = pos;
            pos++;
            return latex.substring(start, pos);
        }
        return "";
    }

    function parseUntil(endChar) {
        let start = pos;
        while (pos < latex.length && latex[pos] !== endChar) {
            pos++;
        }
        let res = latex.substring(start, pos);
        if (pos < latex.length) pos++;
        return res;
    }

    function parseGroupOrUntilDx() {
        skipSpaces();
        if (pos < latex.length && latex[pos] === '{') {
            pos++;
            let val = parse();
            if (pos < latex.length && latex[pos] === '}') {
                pos++;
            }
            return val;
        }
        let start = pos;
        let dxIdx = latex.indexOf('dx', pos);
        if (dxIdx !== -1) {
            pos = dxIdx;
            let res = latex.substring(start, pos).trim();
            pos += 2;
            return res;
        }
        return parseGroup();
    }

    return parse().trim();
}

function findMatchingBrace(str, startIdx) {
    if (str[startIdx] !== '{') return -1;
    let depth = 1;
    for (let i = startIdx + 1; i < str.length; i++) {
        if (str[i] === '{') depth++;
        else if (str[i] === '}') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function findMatchingBracket(str, startIdx) {
    if (str[startIdx] !== '[') return -1;
    let depth = 1;
    for (let i = startIdx + 1; i < str.length; i++) {
        if (str[i] === '[') depth++;
        else if (str[i] === ']') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function getMatrixEntryRanges(matrixContent, matrixContentStartIdx) {
    let entries = [];
    let rowTexts = matrixContent.split(/\\\\|\\cr/);
    let accumulatedRowLength = 0;

    for (let r = 0; r < rowTexts.length; r++) {
        let rowText = rowTexts[r];
        let colTexts = rowText.split('&');
        let accumulatedColLength = 0;

        for (let c = 0; c < colTexts.length; c++) {
            let colText = colTexts[c];
            let trimmed = colText.trim();
            let cellStart = matrixContentStartIdx + accumulatedRowLength + accumulatedColLength;
            let cellEnd = cellStart + colText.length;

            if (trimmed.length > 0) {
                let colOffset = colText.indexOf(trimmed);
                let start = cellStart + colOffset;
                let end = start + trimmed.length;
                entries.push({
                    row: r,
                    col: c,
                    start: start,
                    end: end,
                    cellStart: cellStart,
                    cellEnd: cellEnd,
                    value: trimmed
                });
            } else {
                entries.push({
                    row: r,
                    col: c,
                    start: cellStart,
                    end: cellStart,
                    cellStart: cellStart,
                    cellEnd: cellEnd,
                    value: ""
                });
            }
            accumulatedColLength += colText.length + 1; // +1 for '&'
        }

        let sepLen = 2; // default for '\\'
        let rest = matrixContent.substring(accumulatedRowLength + rowText.length);
        if (rest.startsWith('\\\\')) {
            sepLen = 2;
        } else if (rest.startsWith('\\cr')) {
            sepLen = 3;
        }
        accumulatedRowLength += rowText.length + sepLen;
    }
    return entries;
}

function getTemplateAt(latex, i) {
    // Matrix environments: \begin{bmatrix}...\end{bmatrix} (or matrix or vmatrix)
    let matrixMatch = latex.substring(i).match(/^\\begin\{(bmatrix|vmatrix|matrix)\}/);
    if (matrixMatch) {
        let matrixType = matrixMatch[1];
        let endTag = `\\end{${matrixType}}`;
        let contentStart = i + matrixMatch[0].length;

        let contentEnd = -1;
        let depth = 1;
        let scanIdx = contentStart;
        while (scanIdx < latex.length) {
            if (latex.substring(scanIdx).startsWith(`\\begin{${matrixType}}`)) {
                depth++;
                scanIdx += 7 + matrixType.length;
            } else if (latex.substring(scanIdx).startsWith(endTag)) {
                depth--;
                if (depth === 0) {
                    contentEnd = scanIdx;
                    break;
                }
                scanIdx += endTag.length;
            } else {
                scanIdx++;
            }
        }

        if (contentEnd !== -1) {
            let matrixContent = latex.substring(contentStart, contentEnd);
            let templateEnd = contentEnd + endTag.length;

            let parts = [];
            let entryRanges = getMatrixEntryRanges(matrixContent, contentStart);
            for (let entry of entryRanges) {
                parts.push({
                    start: entry.start,
                    end: entry.end,
                    cellStart: entry.cellStart,
                    cellEnd: entry.cellEnd
                });
            }

            return {
                type: 'matrix',
                start: i,
                end: templateEnd,
                parts: parts
            };
        }
    }

    // Vector: \vec{expr}
    if (latex.substring(i).startsWith('\\vec{')) {
        let exprStart = i + 5;
        let exprEnd = findMatchingBrace(latex, exprStart - 1);
        if (exprEnd !== -1) {
            return {
                type: 'vector',
                start: i,
                end: exprEnd + 1,
                parts: [
                    { start: exprStart, end: exprEnd }
                ]
            };
        }
    }

    // 0. Simple/Atomic commands (e.g. \pi, \infty, \theta, \to, \times, \div, \alpha, \beta, etc.)
    if (latex[i] === '\\') {
        let cmdMatch = latex.substring(i).match(/^\\([a-zA-Z]+)/);
        if (cmdMatch) {
            let cmdName = cmdMatch[1];
            const complexCmds = ['int', 'frac', 'lim', 'sum', 'prod', 'sqrt', 'lvert', 'rvert', 'sin', 'cos', 'tan', 'sinh', 'cosh', 'tanh', 'ln', 'log', 'exp', 'htmlClass', 'sec', 'csc', 'cosec', 'cot', 'sech', 'csch', 'cosech', 'coth'];
            if (!complexCmds.includes(cmdName)) {
                return {
                    type: 'atomic',
                    start: i,
                    end: i + 1 + cmdName.length,
                    parts: []
                };
            }
        }
        else if (i + 1 < latex.length) {
            let nextChar = latex[i + 1];
            if (nextChar === ',' || nextChar === ' ' || nextChar === '\\') {
                return {
                    type: 'atomic',
                    start: i,
                    end: i + 2,
                    parts: []
                };
            }
        }
    }

    // 1. Definite Integral: \int_{lower}^{upper} {expr} \, dx
    if (latex.substring(i).startsWith('\\int_{')) {
        let lowerStart = i + 6;
        let lowerEnd = findMatchingBrace(latex, lowerStart - 1);
        if (lowerEnd !== -1 && latex.substring(lowerEnd).startsWith('}^{')) {
            let upperStart = lowerEnd + 3;
            let upperEnd = findMatchingBrace(latex, upperStart - 1);
            if (upperEnd !== -1) {
                let rest = latex.substring(upperEnd + 1);
                let exprMatch = rest.match(/^(\s*)\{/);
                if (exprMatch) {
                    let exprStart = upperEnd + 1 + exprMatch[1].length + 1;
                    let exprEnd = findMatchingBrace(latex, exprStart - 1);
                    if (exprEnd !== -1) {
                        let afterExpr = latex.substring(exprEnd + 1);
                        let dxMatch = afterExpr.match(/^(\s*(?:\\,)?\s*d[a-zA-Z])/);
                        let templateEnd = exprEnd + 1;
                        if (dxMatch) {
                            templateEnd += dxMatch[0].length;
                        }
                        return {
                            type: 'defint',
                            start: i,
                            end: templateEnd,
                            parts: [
                                { start: lowerStart, end: lowerEnd },
                                { start: upperStart, end: upperEnd },
                                { start: exprStart, end: exprEnd }
                            ]
                        };
                    }
                }
            }
        }
    }

    // 2. Indefinite Integral: \int {expr} \, dx
    if (latex.substring(i).startsWith('\\int') && !latex.substring(i).startsWith('\\int_')) {
        let rest = latex.substring(i + 4);
        let braceMatch = rest.match(/^(\s*)\{/);
        if (braceMatch) {
            let exprStart = i + 4 + braceMatch[1].length + 1;
            let exprEnd = findMatchingBrace(latex, exprStart - 1);
            if (exprEnd !== -1) {
                let afterExpr = latex.substring(exprEnd + 1);
                let dxMatch = afterExpr.match(/^(\s*(?:\\,)?\s*d[a-zA-Z])/);
                let templateEnd = exprEnd + 1;
                if (dxMatch) {
                    templateEnd += dxMatch[0].length;
                }
                return {
                    type: 'int',
                    start: i,
                    end: templateEnd,
                    parts: [
                        { start: exprStart, end: exprEnd }
                    ]
                };
            }
        }
    }

    // 3. High Order Derivative: \frac{d^{order} {expr}}{dx^{order}} or \frac{d^{order}}{dx^{order}} {expr}
    let diffnMatch = latex.substring(i).match(/^\\frac\{d\^(\{?)/);
    if (diffnMatch) {
        let hasBrace = diffnMatch[1] === '{';
        let order1Start = i + (hasBrace ? 9 : 8);
        let order1End = hasBrace ? findMatchingBrace(latex, order1Start - 1) : order1Start + 1;
        if (order1End !== -1) {
            let idxAfterOrder1 = order1End + (hasBrace ? 1 : 0);
            let rest1 = latex.substring(idxAfterOrder1);

            // Try Style A: expression inside the numerator: \frac{d^{order} {expr}}{dx^{order}}
            let exprMatch = rest1.match(/^(\s*)\{/);
            if (exprMatch) {
                let exprStart = idxAfterOrder1 + exprMatch[1].length + 1;
                let exprEnd = findMatchingBrace(latex, exprStart - 1);
                if (exprEnd !== -1 && latex[exprEnd + 1] === '}') {
                    let rest2 = latex.substring(exprEnd + 2);
                    let denMatch = rest2.match(/^\{d([a-zA-Z])\^\{/);
                    if (denMatch) {
                        let order2Start = exprEnd + 2 + denMatch[0].length;
                        let order2End = findMatchingBrace(latex, order2Start - 1);
                        if (order2End !== -1 && latex[order2End + 1] === '}') {
                            return {
                                type: 'diffn',
                                start: i,
                                end: order2End + 2,
                                parts: [
                                    { start: order1Start, end: order1End },
                                    { start: order2Start, end: order2End },
                                    { start: exprStart, end: exprEnd }
                                ]
                            };
                        }
                    }
                }
            }

            // Try Style B (fallback): expression outside the fraction: \frac{d^{order}}{dx^{order}} {expr}
            let denMatch = rest1.match(/^(\s*\})?\{d([a-zA-Z])\^\{/);
            if (denMatch) {
                let order2Start = idxAfterOrder1 + denMatch[0].length;
                let order2End = findMatchingBrace(latex, order2Start - 1);
                if (order2End !== -1) {
                    let fracEnd = order2End + 1;
                    if (rest1.startsWith('}')) {
                        fracEnd += 1;
                    }
                    let rest2 = latex.substring(fracEnd);
                    let exprMatch2 = rest2.match(/^(\s*)\{/);
                    if (exprMatch2) {
                        let exprStart = fracEnd + exprMatch2[1].length + 1;
                        let exprEnd = findMatchingBrace(latex, exprStart - 1);
                        if (exprEnd !== -1) {
                            return {
                                type: 'diffn',
                                start: i,
                                end: exprEnd + 1,
                                parts: [
                                    { start: order1Start, end: order1End },
                                    { start: order2Start, end: order2End },
                                    { start: exprStart, end: exprEnd }
                                ]
                            };
                        }
                    }
                }
            }
        }
    }

    // 4. Derivative: \frac{d}{dx} {expr}
    let derivMatch = latex.substring(i).match(/^\\frac\{d\}\{d([a-zA-Z])\}/);
    if (derivMatch) {
        let fracEnd = i + derivMatch[0].length;
        let rest = fracEnd < latex.length ? latex.substring(fracEnd) : "";
        let exprMatch = rest.match(/^(\s*)\{/);
        if (exprMatch) {
            let exprStart = fracEnd + exprMatch[1].length + 1;
            let exprEnd = findMatchingBrace(latex, exprStart - 1);
            if (exprEnd !== -1) {
                return {
                    type: 'diff',
                    start: i,
                    end: exprEnd + 1,
                    parts: [
                        { start: exprStart, end: exprEnd }
                    ]
                };
            }
        }
    }

    // 5. Fraction: \frac{num}{den}
    if (latex.substring(i).startsWith('\\frac{')) {
        let numStart = i + 6;
        let numEnd = findMatchingBrace(latex, numStart - 1);
        if (numEnd !== -1 && latex.substring(numEnd + 1).startsWith('{')) {
            let denStart = numEnd + 2;
            let denEnd = findMatchingBrace(latex, denStart - 1);
            if (denEnd !== -1) {
                return {
                    type: 'frac',
                    start: i,
                    end: denEnd + 1,
                    parts: [
                        { start: numStart, end: numEnd },
                        { start: denStart, end: denEnd }
                    ]
                };
            }
        }
    }

    // 6. Limit: \lim_{var \to target} {expr}
    if (latex.substring(i).startsWith('\\lim_{')) {
        let condStart = i + 6;
        let condEnd = findMatchingBrace(latex, condStart - 1);
        if (condEnd !== -1) {
            let rest = latex.substring(condEnd + 1);
            let exprMatch = rest.match(/^(\s*)\{/);
            if (exprMatch) {
                let exprStart = condEnd + 1 + exprMatch[1].length + 1;
                let exprEnd = findMatchingBrace(latex, exprStart - 1);
                if (exprEnd !== -1) {
                    return {
                        type: 'limit',
                        start: i,
                        end: exprEnd + 1,
                        parts: [
                            { start: condStart, end: condEnd },
                            { start: exprStart, end: exprEnd }
                        ]
                    };
                }
            }
        }
    }

    // 7. Sum / Product: \sum_{lower}^{upper} {expr} or \prod_{lower}^{upper} {expr}
    let sumProdMatch = latex.substring(i).match(/^\\(sum|prod)_\{/);
    if (sumProdMatch) {
        let lowerStart = i + sumProdMatch[0].length;
        let lowerEnd = findMatchingBrace(latex, lowerStart - 1);
        if (lowerEnd !== -1 && latex.substring(lowerEnd).startsWith('}^{')) {
            let upperStart = lowerEnd + 3;
            let upperEnd = findMatchingBrace(latex, upperStart - 1);
            if (upperEnd !== -1) {
                let rest = latex.substring(upperEnd + 1);
                let exprMatch = rest.match(/^(\s*)\{/);
                if (exprMatch) {
                    let exprStart = upperEnd + 1 + exprMatch[1].length + 1;
                    let exprEnd = findMatchingBrace(latex, exprStart - 1);
                    if (exprEnd !== -1) {
                        return {
                            type: sumProdMatch[1],
                            start: i,
                            end: exprEnd + 1,
                            parts: [
                                { start: lowerStart, end: lowerEnd },
                                { start: upperStart, end: upperEnd },
                                { start: exprStart, end: exprEnd }
                            ]
                        };
                    }
                }
            }
        }
    }

    // 8. N-th Root: \sqrt[n]{expr} (with optional/empty n)
    if (latex.substring(i).startsWith('\\sqrt[')) {
        let nStart = i + 6;
        let nEnd = findMatchingBracket(latex, nStart - 1);
        if (nEnd !== -1 && latex.substring(nEnd + 1).startsWith('{')) {
            let exprStart = nEnd + 2;
            let exprEnd = findMatchingBrace(latex, exprStart - 1);
            if (exprEnd !== -1) {
                return {
                    type: 'nrt',
                    start: i,
                    end: exprEnd + 1,
                    parts: [
                        { start: nStart, end: nEnd },
                        { start: exprStart, end: exprEnd }
                    ]
                };
            }
        }
    }

    // 9. Square Root: \sqrt{expr}
    if (latex.substring(i).startsWith('\\sqrt{')) {
        let exprStart = i + 6;
        let exprEnd = findMatchingBrace(latex, exprStart - 1);
        if (exprEnd !== -1) {
            return {
                type: 'sqrt',
                start: i,
                end: exprEnd + 1,
                parts: [
                    { start: exprStart, end: exprEnd }
                ]
            };
        }
    }

    // 10. Absolute Value: \lvert {expr} \rvert or \lvert expr \rvert
    if (latex.substring(i).startsWith('\\lvert')) {
        let rest = latex.substring(i + 6);
        let braceMatch = rest.match(/^(\s*)\{/);
        if (braceMatch) {
            let exprStart = i + 6 + braceMatch[1].length + 1;
            let exprEnd = findMatchingBrace(latex, exprStart - 1);
            if (exprEnd !== -1 && latex.substring(exprEnd + 1).trim().startsWith('\\rvert')) {
                let rvertMatch = latex.substring(exprEnd + 1).match(/^(\s*\\rvert)/);
                return {
                    type: 'abs',
                    start: i,
                    end: exprEnd + 1 + rvertMatch[0].length,
                    parts: [
                        { start: exprStart, end: exprEnd }
                    ]
                };
            }
        }
        // If not braced, try simple pairing: \lvert expr \rvert
        let depth = 1;
        let pos = i + 6;
        while (pos < latex.length && depth > 0) {
            if (latex.substring(pos).startsWith('\\lvert')) {
                depth++;
                pos += 6;
            } else if (latex.substring(pos).startsWith('\\rvert')) {
                depth--;
                if (depth === 0) {
                    break;
                }
                pos += 6;
            } else {
                pos++;
            }
        }
        if (depth === 0) {
            return {
                type: 'abs',
                start: i,
                end: pos + 6,
                parts: [
                    { start: i + 6, end: pos }
                ]
            };
        }
    }

    // 11. Factorial: \[[expr]! \]
    if (latex.substring(i).startsWith('\\[')) {
        let rest = latex.substring(i + 2);
        let braceMatch = rest.match(/^(\s*)\{/);
        if (braceMatch) {
            let exprStart = i + 2 + braceMatch[1].length + 1;
            let exprEnd = findMatchingBrace(latex, exprStart - 1);
            if (exprEnd !== -1) {
                let afterExpr = latex.substring(exprEnd + 1);
                let factMatch = afterExpr.match(/^(\s*!\s*\\\])/);
                if (factMatch) {
                    return {
                        type: 'fact',
                        start: i,
                        end: exprEnd + 1 + factMatch[0].length,
                        parts: [
                            { start: exprStart, end: exprEnd }
                        ]
                    };
                }
            }
        }
    }

    // 12a. Custom Base Logarithm: \log_{base}{expr} or \mathrm{log}_{base}{expr}
    let logbaseMatch = latex.substring(i).match(/^\\(log|mathrm\{log\})_\{([^{}]*)\}/);
    if (logbaseMatch) {
        let baseVal = logbaseMatch[2];
        let baseStart = i + logbaseMatch[0].lastIndexOf('{') + 1;
        let baseEnd = baseStart + baseVal.length;
        let cmdEnd = i + logbaseMatch[0].length;
        let rest = latex.substring(cmdEnd);
        let braceMatch = rest.match(/^(\s*)\{/);
        if (braceMatch) {
            let exprStart = cmdEnd + braceMatch[1].length + 1;
            let exprEnd = findMatchingBrace(latex, exprStart - 1);
            if (exprEnd !== -1) {
                return {
                    type: 'logbase',
                    start: i,
                    end: exprEnd + 1,
                    parts: [
                        { start: baseStart, end: baseEnd },
                        { start: exprStart, end: exprEnd }
                    ]
                };
            }
        }
    }

    // 12. Standard Functions: \sin, \cos, \tan, etc. (with optional power)
    let funcMatch = latex.substring(i).match(/^\\(sin|cos|tan|sec|csc|cosec|cot|sinh|cosh|tanh|sech|csch|cosech|coth|ln|log|exp)(?:\^\{([^{}]*)\})?/);
    if (funcMatch) {
        let fnName = funcMatch[1];
        let hasPower = !!funcMatch[2];
        let powerVal = funcMatch[2] || "";
        let cmdEnd = i + funcMatch[0].length;
        let rest = latex.substring(cmdEnd);
        let braceMatch = rest.match(/^(\s*)\{/);
        if (braceMatch) {
            let exprStart = cmdEnd + braceMatch[1].length + 1;
            let exprEnd = findMatchingBrace(latex, exprStart - 1);
            if (exprEnd !== -1) {
                let parts = [];
                if (hasPower) {
                    let powerStart = i + fnName.length + 3; // length of \ + name + ^{
                    let powerEnd = powerStart + powerVal.length;
                    parts.push({ start: powerStart, end: powerEnd });
                }
                parts.push({ start: exprStart, end: exprEnd });
                return {
                    type: 'func',
                    start: i,
                    end: exprEnd + 1,
                    parts: parts
                };
            }
        }
    }

    // 13. Exponent: ^{expr}
    if (latex.substring(i).startsWith('^{')) {
        let exprStart = i + 2;
        let exprEnd = findMatchingBrace(latex, exprStart - 1);
        if (exprEnd !== -1) {
            return {
                type: 'exponent',
                start: i,
                end: exprEnd + 1,
                parts: [
                    { start: exprStart, end: exprEnd }
                ]
            };
        }
    }

    // 14. Subscript: _{expr}
    if (latex.substring(i).startsWith('_{')) {
        let exprStart = i + 2;
        let exprEnd = findMatchingBrace(latex, exprStart - 1);
        if (exprEnd !== -1) {
            return {
                type: 'subscript',
                start: i,
                end: exprEnd + 1,
                parts: [
                    { start: exprStart, end: exprEnd }
                ]
            };
        }
    }

    return null;
}

function getAllTemplates(latex) {
    let templates = [];

    function scan(start, end) {
        let i = start;
        while (i < end) {
            let t = getTemplateAt(latex, i);
            if (t) {
                templates.push(t);
                for (let part of t.parts) {
                    scan(part.start, part.end);
                }
                i = t.end;
            } else {
                i++;
            }
        }
    }

    scan(0, latex.length);
    // Add extra scanning for inner matches inside outer boundaries if needed,
    // but the recursive call scan(part.start, part.end) already handles nesting.
    return templates;
}

function getInnermostTemplatePart(latex, pos) {
    const templates = getAllTemplates(latex);
    let bestTemplate = null;
    let bestPartIndex = -1;
    let minPartLength = Infinity;
    for (let t of templates) {
        for (let k = 0; k < t.parts.length; k++) {
            let part = t.parts[k];
            if (pos >= part.start && pos <= part.end) {
                let len = part.end - part.start;
                if (len < minPartLength) {
                    minPartLength = len;
                    bestTemplate = t;
                    bestPartIndex = k;
                }
            }
        }
    }
    return { template: bestTemplate, partIndex: bestPartIndex };
}

function isAllowed(latex, pos) {
    const templates = getAllTemplates(latex);
    for (let t of templates) {
        if (pos > t.start && pos < t.end) {
            let inPart = false;
            for (let part of t.parts) {
                if (pos >= part.start && pos <= part.end) {
                    inPart = true;
                    break;
                }
            }
            if (!inPart) {
                return false;
            }
        }
    }
    return true;
}

function getClosestAllowedPosition(latex, pos, direction) {
    if (pos < 0) pos = 0;
    if (pos > latex.length) pos = latex.length;

    if (isAllowed(latex, pos)) {
        return pos;
    }

    if (direction === 'forward') {
        for (let p = pos + 1; p <= latex.length; p++) {
            if (isAllowed(latex, p)) return p;
        }
        for (let p = pos - 1; p >= 0; p--) {
            if (isAllowed(latex, p)) return p;
        }
    } else if (direction === 'backward') {
        for (let p = pos - 1; p >= 0; p--) {
            if (isAllowed(latex, p)) return p;
        }
        for (let p = pos + 1; p <= latex.length; p++) {
            if (isAllowed(latex, p)) return p;
        }
    } else {
        let left = -1;
        let right = -1;
        for (let p = pos - 1; p >= 0; p--) {
            if (isAllowed(latex, p)) {
                left = p;
                break;
            }
        }
        for (let p = pos + 1; p <= latex.length; p++) {
            if (isAllowed(latex, p)) {
                right = p;
                break;
            }
        }
        if (left !== -1 && right !== -1) {
            return (pos - left <= right - pos) ? left : right;
        }
        if (left !== -1) return left;
        if (right !== -1) return right;
    }

    return pos;
}

function enforceCursorBounds(math, direction) {
    if (!math) return;
    const start = math.selectionStart;
    const end = math.selectionEnd;

    const newStart = getClosestAllowedPosition(math.value, start, direction);
    const newEnd = getClosestAllowedPosition(math.value, end, direction);

    if (newStart !== start || newEnd !== end) {
        math.setSelectionRange(newStart, newEnd);
    }
}

function syncDiffnOrder(math) {
    const val = math.value;
    const pos = math.selectionStart;
    const templates = getAllTemplates(val);
    let newVal = val;
    let newPos = pos;
    let changed = false;

    for (let t of templates) {
        if (t.type === 'diffn') {
            const ord1 = val.substring(t.parts[0].start, t.parts[0].end);
            const ord2 = val.substring(t.parts[1].start, t.parts[1].end);
            if (ord1 !== ord2) {
                let editedVal = ord1;
                if (pos >= t.parts[1].start && pos <= t.parts[1].end) {
                    editedVal = ord2;
                }

                const beforeOrd1 = val.substring(0, t.parts[0].start);
                const betweenOrds = val.substring(t.parts[0].end, t.parts[1].start);
                const afterOrd2 = val.substring(t.parts[1].end);

                newVal = beforeOrd1 + editedVal + betweenOrds + editedVal + afterOrd2;

                if (pos >= t.parts[0].start && pos <= t.parts[0].end) {
                    newPos = t.parts[0].start + (pos - t.parts[0].start);
                } else if (pos >= t.parts[1].start && pos <= t.parts[1].end) {
                    const shift = editedVal.length - ord1.length;
                    newPos = t.parts[1].start + shift + (pos - t.parts[1].start);
                }

                changed = true;
                break;
            }
        }
    }

    if (changed) {
        math.value = newVal;
        math.setSelectionRange(newPos, newPos);
    }
}

function onSelectionChange(direction) {
    const math = document.getElementById("math");
    if (!math) return;

    if (direction === undefined) {
        const val = math.value;
        const pos = math.selectionStart;
        if (pos === math.selectionEnd) {
            if (val[pos] === '_' && val[pos + 1] !== '{') {
                math.setSelectionRange(pos, pos + 1);
            } else if (pos > 0 && val[pos - 1] === '_' && val[pos] !== '{') {
                math.setSelectionRange(pos - 1, pos);
            }
        }
    }

    enforceCursorBounds(math, direction);
    syncDiffnOrder(math);
    syncSelectionToOde();
    updateMathOverlay();
}

function findNextPlaceholder(val, startPos) {
    let bestIdx = -1;

    // 1. Find next '_' (non-subscript)
    let idx = val.indexOf('_', startPos);
    while (idx !== -1) {
        if (val[idx + 1] !== '{') {
            if (bestIdx === -1 || idx < bestIdx) {
                bestIdx = idx;
            }
            break;
        }
        idx = val.indexOf('_', idx + 1);
    }

    // 2. Find next '[]'
    let idxBrackets = val.indexOf('[]', startPos);
    if (idxBrackets !== -1) {
        if (bestIdx === -1 || idxBrackets < bestIdx) {
            bestIdx = idxBrackets;
        }
    }

    // 3. Find next '[\ ]'
    let idxBackslashBrackets = val.indexOf('[\\ ]', startPos);
    if (idxBackslashBrackets !== -1) {
        if (bestIdx === -1 || idxBackslashBrackets < bestIdx) {
            bestIdx = idxBackslashBrackets;
        }
    }

    // 4. Find next '{}'
    let idxBraces = val.indexOf('{}', startPos);
    if (idxBraces !== -1) {
        if (bestIdx === -1 || idxBraces < bestIdx) {
            bestIdx = idxBraces;
        }
    }

    return bestIdx;
}

function selectPlaceholder(math, nextUnderIdx) {
    const val = math.value;
    if (val.substring(nextUnderIdx, nextUnderIdx + 4) === '[\\ ]') {
        math.setSelectionRange(nextUnderIdx + 1, nextUnderIdx + 1);
    } else if (val.substring(nextUnderIdx, nextUnderIdx + 2) === '[]') {
        math.setSelectionRange(nextUnderIdx + 1, nextUnderIdx + 1);
    } else if (val.substring(nextUnderIdx, nextUnderIdx + 2) === '{}') {
        math.setSelectionRange(nextUnderIdx + 1, nextUnderIdx + 1);
    } else {
        math.setSelectionRange(nextUnderIdx, nextUnderIdx + 1);
    }
}

function findLastMatrixMatch(textBefore) {
    let match = textBefore.match(/\\end\{(bmatrix|vmatrix|matrix)\}(?:_\{[^}]*\})?$/);
    if (!match) return null;

    let type = match[1];
    let endStr = match[0];
    let endIdx = textBefore.length - endStr.length;

    let depth = 1;
    let idx = endIdx;
    while (idx >= 0 && depth > 0) {
        let beginTag = `\\begin{${type}}`;
        let endTag = `\\end{${type}}`;

        let sub = textBefore.substring(0, idx);
        if (sub.endsWith(beginTag)) {
            depth--;
            idx -= beginTag.length;
            if (depth === 0) {
                return { start: idx, length: textBefore.length - idx };
            }
        } else if (sub.endsWith(endTag)) {
            depth++;
            idx -= endTag.length;
        } else {
            idx--;
        }
    }
    return null;
}

let lastEmptyBoundBackspace = null;

function tryDeleteLatexCommand(math) {
    const pos = math.selectionStart;
    if (pos !== math.selectionEnd) return false;

    const val = math.value;

    const textBefore = val.substring(0, pos);

    // Check if backspacing over a matrix structure safely using our helper
    let matrixMatch = findLastMatrixMatch(textBefore);
    if (matrixMatch) {
        let matchLen = matrixMatch.length;
        let startDelete = pos - matchLen;

        let textAfter = val.substring(pos);
        let subscriptMatch = textAfter.match(/^_(?:\{[^}]*\})/);
        let deleteAfterLen = subscriptMatch ? subscriptMatch[0].length : 0;

        math.value = val.substring(0, startDelete) + val.substring(pos + deleteAfterLen);
        math.setSelectionRange(startDelete, startDelete);
        lastEmptyBoundBackspace = null;
        return true;
    }

    // Check if backspacing over 'laplace' or 'ilaplace' keyword
    if (textBefore.endsWith('ilaplace')) {
        math.value = val.substring(0, pos - 8) + val.substring(pos);
        math.setSelectionRange(pos - 8, pos - 8);
        lastEmptyBoundBackspace = null;
        return true;
    }
    if (textBefore.endsWith('laplace')) {
        math.value = val.substring(0, pos - 7) + val.substring(pos);
        math.setSelectionRange(pos - 7, pos - 7);
        lastEmptyBoundBackspace = null;
        return true;
    }

    if (textBefore.endsWith('\\hat{i}')) {
        math.value = val.substring(0, pos - 7) + val.substring(pos);
        math.setSelectionRange(pos - 7, pos - 7);
        lastEmptyBoundBackspace = null;
        return true;
    }
    if (textBefore.endsWith('\\hat{j}')) {
        math.value = val.substring(0, pos - 7) + val.substring(pos);
        math.setSelectionRange(pos - 7, pos - 7);
        lastEmptyBoundBackspace = null;
        return true;
    }
    if (textBefore.endsWith('\\hat{k}')) {
        math.value = val.substring(0, pos - 7) + val.substring(pos);
        math.setSelectionRange(pos - 7, pos - 7);
        lastEmptyBoundBackspace = null;
        return true;
    }
    if (textBefore.endsWith('\\hat{}')) {
        math.value = val.substring(0, pos - 6) + val.substring(pos);
        math.setSelectionRange(pos - 6, pos - 6);
        lastEmptyBoundBackspace = null;
        return true;
    }
    if (textBefore.endsWith('\\hat{')) {
        math.value = val.substring(0, pos - 5) + val.substring(pos);
        math.setSelectionRange(pos - 5, pos - 5);
        lastEmptyBoundBackspace = null;
        return true;
    }

    const cmdMatch = textBefore.match(/\\([a-zA-Z]+)$/);
    if (cmdMatch) {
        const cmdLen = cmdMatch[0].length;
        math.value = val.substring(0, pos - cmdLen) + val.substring(pos);
        math.setSelectionRange(pos - cmdLen, pos - cmdLen);
        lastEmptyBoundBackspace = null;
        return true;
    }

    const templates = getAllTemplates(val);

    // Double backspace check inside empty bounds
    let insideEmptyBound = false;
    let emptyBoundTemplate = null;
    let emptyBoundPartIndex = -1;

    for (let t of templates) {
        if (t.type === 'matrix') continue; // Don't trigger empty bounds double-backspace for matrix cells
        for (let k = 0; k < t.parts.length; k++) {
            let part = t.parts[k];
            if (part.start === part.end && pos === part.start) {
                insideEmptyBound = true;
                emptyBoundTemplate = t;
                emptyBoundPartIndex = k;
                break;
            }
        }
        if (insideEmptyBound) break;
    }

    if (insideEmptyBound) {
        if (lastEmptyBoundBackspace && lastEmptyBoundBackspace.pos === pos && lastEmptyBoundBackspace.value === val) {
            const left = val.substring(0, emptyBoundTemplate.start);
            const right = val.substring(emptyBoundTemplate.end);
            math.value = left + right;
            math.setSelectionRange(emptyBoundTemplate.start, emptyBoundTemplate.start);
            lastEmptyBoundBackspace = null;
            return true;
        } else {
            lastEmptyBoundBackspace = { pos: pos, value: val };
            return true;
        }
    }

    lastEmptyBoundBackspace = null;

    for (let t of templates) {
        if (pos === t.end) {
            const left = val.substring(0, t.start);
            const right = val.substring(t.end);
            math.value = left + right;
            math.setSelectionRange(t.start, t.start);
            return true;
        }
        for (let k = 1; k < t.parts.length; k++) {
            let part = t.parts[k];
            let isAtStart = false;
            if (t.type === 'matrix') {
                isAtStart = (pos >= part.cellStart && pos <= part.start);
            } else {
                isAtStart = (pos === part.start);
            }
            if (isAtStart) {
                let prevPart = t.parts[k - 1];
                math.setSelectionRange(prevPart.end, prevPart.end);
                return true;
            }
        }
        if (t.parts.length > 0) {
            let part = t.parts[0];
            let isAtStart = false;
            if (t.type === 'matrix') {
                isAtStart = (pos >= part.cellStart && pos <= part.start);
            } else {
                isAtStart = (pos === part.start);
            }
            if (isAtStart) {
                const left = val.substring(0, t.start);
                const right = val.substring(t.end);
                math.value = left + right;
                math.setSelectionRange(t.start, t.start);
                return true;
            }
        }
    }
    return false;
}

function tryDeleteLatexCommandForward(math) {
    const pos = math.selectionStart;
    if (pos !== math.selectionEnd) return false;

    const val = math.value;
    const templates = getAllTemplates(val);

    for (let t of templates) {
        if (pos === t.start) {
            const left = val.substring(0, t.start);
            const right = val.substring(t.end);
            math.value = left + right;
            math.setSelectionRange(t.start, t.start);
            return true;
        }
        for (let k = 0; k < t.parts.length - 1; k++) {
            let part = t.parts[k];
            let isAtEnd = false;
            if (t.type === 'matrix') {
                isAtEnd = (pos >= part.end && pos <= part.cellEnd);
            } else {
                isAtEnd = (pos === part.end);
            }
            if (isAtEnd) {
                let nextPart = t.parts[k + 1];
                math.setSelectionRange(nextPart.start, nextPart.start);
                return true;
            }
        }
        if (t.parts.length > 0) {
            let part = t.parts[t.parts.length - 1];
            let isAtEnd = false;
            if (t.type === 'matrix') {
                isAtEnd = (pos >= part.end && pos <= part.cellEnd);
            } else {
                isAtEnd = (pos === part.end);
            }
            if (isAtEnd) {
                math.setSelectionRange(t.end, t.end);
                return true;
            }
        }
    }
    return false;
}

function extractNumeratorBeforeSlash(textBefore) {
    let slashIdx = textBefore.lastIndexOf('/');
    if (slashIdx === -1) return { term: "", remaining: textBefore };

    let beforeSlash = textBefore.substring(0, slashIdx);
    let trimmedBefore = beforeSlash.trimEnd();
    let spacesCount = beforeSlash.length - trimmedBefore.length;




    if (trimmedBefore.length === 0) return { term: "", remaining: textBefore };

    let i = trimmedBefore.length - 1;
    let char = trimmedBefore[i];

    // Case 1: Parentheses group, e.g. (x+1)/
    if (char === ')') {
        let depth = 1;
        let j = i - 1;
        while (j >= 0 && depth > 0) {
            if (trimmedBefore[j] === ')') depth++;
            else if (trimmedBefore[j] === '(') depth--;
            j--;
        }
        if (depth === 0) {
            let inner = trimmedBefore.substring(j + 2, i);
            let remaining = trimmedBefore.substring(0, j + 1) + ' '.repeat(spacesCount);
            return { term: inner, remaining: remaining };
        }
    }

    // Case 1.5: LaTeX brace group or command or superscript/subscript, e.g. \sin{x}/ or x^{2}/
    if (char === '}') {
        const templates = getAllTemplates(trimmedBefore);
        let matchingTemplate = null;
        for (let t of templates) {
            if (t.end === trimmedBefore.length) {
                if (!matchingTemplate || t.start < matchingTemplate.start) {
                    matchingTemplate = t;
                }
            }
        }
        if (matchingTemplate) {
            let startIdx = matchingTemplate.start;
            if (matchingTemplate.type === 'exponent' || matchingTemplate.type === 'subscript') {
                let baseEnd = startIdx;
                let baseStart = baseEnd - 1;
                if (baseStart >= 0) {
                    if (trimmedBefore[baseStart] === '}') {
                        let depth = 1;
                        let k = baseStart - 1;
                        while (k >= 0 && depth > 0) {
                            if (trimmedBefore[k] === '}') depth++;
                            else if (trimmedBefore[k] === '{') depth--;
                            k--;
                        }
                        if (depth === 0) {
                            baseStart = k + 1;
                            let baseTemplate = null;
                            for (let t of templates) {
                                if (t.end === baseEnd) {
                                    if (!baseTemplate || t.start < baseTemplate.start) {
                                        baseTemplate = t;
                                    }
                                }
                            }
                            if (matrixExpanded) return;

                            if (baseTemplate) {
                                baseStart = baseTemplate.start;
                            } else {
                                let temp = baseStart - 1;
                                while (temp >= 0) {
                                    let c = trimmedBefore[temp];
                                    if (/[a-zA-Z0-9]/.test(c)) {
                                        temp--;
                                    } else if (c === '\\') {
                                        temp--;
                                        break;
                                    } else {
                                        break;
                                    }
                                }
                                baseStart = temp + 1;
                            }
                        }
                    } else {
                        let temp = baseStart;
                        while (temp >= 0) {
                            let c = trimmedBefore[temp];
                            if (/[a-zA-Z0-9]/.test(c)) {
                                temp--;
                            } else if (c === '\\') {
                                temp--;
                                break;
                            } else {
                                break;
                            }
                        }
                        baseStart = temp + 1;
                    }
                }
                startIdx = baseStart;
            }
            let term = trimmedBefore.substring(startIdx);
            let remaining = trimmedBefore.substring(0, startIdx) + ' '.repeat(spacesCount);
            return { term: term, remaining: remaining };
        }
    }

    // Case 2: Alphanumeric word / number / command, e.g. 12/, x/, \pi/
    let start = i;
    while (start >= 0) {
        let c = trimmedBefore[start];
        if (/[a-zA-Z0-9]/.test(c)) {
            start--;
        } else if (c === '\\') {
            start--; // include the backslash
            break;
        } else {
            break;
        }
    }

    let term = trimmedBefore.substring(start + 1, i + 1);
    let remaining = trimmedBefore.substring(0, start + 1) + ' '.repeat(spacesCount);
    return { term: term, remaining: remaining };
}

function handleMathInput() {
    const math = document.getElementById("math");
    const ode = document.getElementById("ode");
    if (!math || !ode) return;

    if (typeof window !== 'undefined' && window.mathSolverLastSolution) {
        window.mathSolverLastSolution = "";
    }

    const newVal = math.value;
    if (isProgrammaticUpdate) {
        lastMathValue = newVal;
        ode.value = translateLatexToNerdamer(newVal);
        lastOdeValue = ode.value;
        updateMathOverlay();
        return;
    }

    const pos = math.selectionStart;
    const textBefore = math.value.substring(0, pos);

    let replaced = false;
    let newCursor = pos;

    // Auto-replace hati, hatj, hatk
    let regex = /(hati|hatj|hatk)/g;
    if (regex.test(math.value)) {
        let origVal = math.value;
        let startSel = math.selectionStart;
        let endSel = math.selectionEnd;
        let cursorShiftStart = 0;
        let cursorShiftEnd = 0;
        let match;
        regex.lastIndex = 0;
        while ((match = regex.exec(origVal)) !== null) {
            let matchIdx = match.index;
            let matchStr = match[0];
            let replaceStr = '';
            if (matchStr === 'hati') replaceStr = '\\hat{i}';
            else if (matchStr === 'hatj') replaceStr = '\\hat{j}';
            else if (matchStr === 'hatk') replaceStr = '\\hat{k}';
            let diff = replaceStr.length - matchStr.length;
            if (matchIdx < startSel) cursorShiftStart += diff;
            if (matchIdx < endSel) cursorShiftEnd += diff;
        }
        isProgrammaticUpdate = true;
        math.value = origVal.replace(/hati/g, '\\hat{i}').replace(/hatj/g, '\\hat{j}').replace(/hatk/g, '\\hat{k}');
        newCursor = startSel + cursorShiftStart;
        math.setSelectionRange(newCursor, endSel + cursorShiftEnd);
        isProgrammaticUpdate = false;
        replaced = true;
        setSymbolMode('vector', true);
    }

    // ── Custom Triggers ──
    if (!replaced && textBefore.endsWith('crossprod')) {
        let left = textBefore.substring(0, textBefore.length - 9);
        math.value = left + '\\times ' + math.value.substring(pos);
        newCursor = left.length + 8;
        replaced = true;
    }
    else if (!replaced && textBefore.endsWith('bmatrix')) {
        let left = textBefore.substring(0, textBefore.length - 7);
        let insertText = '\\begin{bmatrix}\\end{bmatrix}_{_ \\times _}';
        math.value = left + insertText + math.value.substring(pos);
        let subStart = insertText.indexOf('_{');
        let underIdx = insertText.indexOf('_', subStart + 2);
        newCursor = left.length + underIdx;
        replaced = true;
        setSymbolMode('matrix', true);
    }
    else if (!replaced && textBefore.endsWith('complex')) {
        let left = textBefore.substring(0, textBefore.length - 7);
        math.value = left + 'a+bi' + math.value.substring(pos);
        newCursor = left.length + 4;
        replaced = true;
        setSymbolMode('complex', true);
    }
    else if (!replaced && textBefore.match(/vec\(([a-zA-Z0-9]+)\)$/)) {
        let match = textBefore.match(/vec\(([a-zA-Z0-9]+)\)$/);
        let varName = match[1];
        let left = textBefore.substring(0, textBefore.length - match[0].length);
        math.value = left + `\\vec{${varName}}` + math.value.substring(pos);
        newCursor = left.length + 6 + varName.length + 1; // after }
        replaced = true;
        setSymbolMode('vector', true);
    }

    let diffnTypedMatch = textBefore.match(/\\frac\{d([a-zA-Z0-9]+)\}\{d([a-zA-Z])\1$/);
    if (!replaced && diffnTypedMatch) {
        let order = diffnTypedMatch[1];
        let wrt = diffnTypedMatch[2];
        let textAfter = math.value.substring(pos);
        if (textAfter.startsWith('}')) {
            let left = textBefore.substring(0, textBefore.length - diffnTypedMatch[0].length);
            let right = textAfter.substring(1);
            let displayOrder = (order.toLowerCase() === 'n') ? '' : order;
            math.value = left + `\\frac{d^{${displayOrder}} {}}{d${wrt}^{${displayOrder}}}` + right;
            newCursor = left.length + 9;
            replaced = true;
        }
    }

    let dderivMatch = textBefore.match(/\\frac\{d\}\{d([a-zA-Z])$/);
    if (dderivMatch) {
        let wrt = dderivMatch[1];
        let textAfter = math.value.substring(pos);
        if (textAfter.startsWith('}')) {
            let left = textBefore.substring(0, textBefore.length - 11); // remove '\frac{d}{d<var>'
            let right = textAfter.substring(1); // remove '}'
            math.value = left + `\\frac{d}{d${wrt}} {}` + right;
            newCursor = left.length + 14;
            replaced = true;
        }
    }

    if (!replaced && textBefore.endsWith('defint')) {
        math.value = math.value.substring(0, pos - 6) + '\\int_{}^{} {}\\, dx' + math.value.substring(pos);
        newCursor = pos - 6 + 6;
        replaced = true;
    }
    else if (!replaced && textBefore.endsWith('int')) {
        if (!textBefore.endsWith('defint')) {
            math.value = math.value.substring(0, pos - 3) + '\\int {}\\, dx' + math.value.substring(pos);
            newCursor = pos - 3 + 6;
            replaced = true;
        }
    }
    else if (!replaced && textBefore.endsWith('diffn')) {
        math.value = math.value.substring(0, pos - 5) + '\\frac{d^{} {}}{dx^{}}' + math.value.substring(pos);
        newCursor = pos - 5 + 9;
        replaced = true;
    }
    else if (!replaced && textBefore.endsWith('diff')) {
        if (!textBefore.endsWith('diffn')) {
            math.value = math.value.substring(0, pos - 4) + '\\frac{d}{dx} {}' + math.value.substring(pos);
            newCursor = pos - 4 + 14;
            replaced = true;
        }
    }
    else if (!replaced && textBefore.endsWith('limit')) {
        math.value = math.value.substring(0, pos - 5) + '\\lim_{x \\to 0} {}' + math.value.substring(pos);
        newCursor = pos - 5 + 6;
        replaced = true;
    }
    else if (!replaced && textBefore.endsWith('lim')) {
        if (!textBefore.endsWith('delim')) {
            math.value = math.value.substring(0, pos - 3) + '\\lim_{x \\to 0} {}' + math.value.substring(pos);
            newCursor = pos - 3 + 6;
            replaced = true;
        }
    }
    else if (!replaced && textBefore.endsWith('sum')) {
        math.value = math.value.substring(0, pos - 3) + '\\sum_{}^{} {}' + math.value.substring(pos);
        newCursor = pos - 3 + 6;
        replaced = true;
    }
    else if (!replaced && textBefore.endsWith('prod')) {
        math.value = math.value.substring(0, pos - 4) + '\\prod_{}^{} {}' + math.value.substring(pos);
        newCursor = pos - 4 + 7;
        replaced = true;
    }
    // Function inline power morphing (e.g. \sin{^ -> \sin^{}{})
    let funcPowerMatch = textBefore.match(/\\(sin|cos|tan|sinh|cosh|tanh|ln|log|exp|sec|csc|cosec|cot|sech|csch|cosech|coth)\{\^$/);
    if (!replaced && funcPowerMatch) {
        let fnName = funcPowerMatch[1];
        let textAfter = math.value.substring(pos);
        if (textAfter.startsWith('}')) {
            let left = textBefore.substring(0, textBefore.length - (1 + fnName.length + 2));
            let right = textAfter.substring(1);
            math.value = left + `\\${fnName}^{}{}` + right;
            newCursor = left.length + 1 + fnName.length + 2;
            replaced = true;
        }
    }

    // Parenthesized power morphing (e.g. \sin^{2(}{} -> \sin^{2}{(})
    let funcPowerParenMatch = textBefore.match(/\\(sin|cos|tan|sinh|cosh|tanh|ln|log|exp|sec|csc|cosec|cot|sech|csch|cosech|coth)\^\{([^}]+)\($/);
    if (!replaced && funcPowerParenMatch) {
        let fnName = funcPowerParenMatch[1];
        let power = funcPowerParenMatch[2];
        let textAfter = math.value.substring(pos);
        if (textAfter.startsWith('}{')) {
            let left = textBefore.substring(0, textBefore.length - (fnName.length + power.length + 4));
            let right = textAfter.substring(2);
            math.value = left + `\\${fnName}^{${power}}{(` + right;
            newCursor = left.length + fnName.length + 4 + power.length + 2;
            replaced = true;
        }
    }

    // Rule A: Exit power group when non-digit character typed after numeric power
    // e.g. typing 'x' in \sin^{2x}{} → restructures to \sin^{2}{x}
    let funcPowerExitMatch = textBefore.match(/\\(sin|cos|tan|sinh|cosh|tanh|ln|log|exp|sec|csc|cosec|cot|sech|csch|cosech|coth)\^\{(\d+(?:\.\d*)?)([a-zA-Z])$/);
    if (!replaced && funcPowerExitMatch) {
        let fnName = funcPowerExitMatch[1];
        let power = funcPowerExitMatch[2];
        let argChar = funcPowerExitMatch[3];
        let textAfter = math.value.substring(pos);
        if (textAfter.startsWith('}{')) {
            let matchedLen = 1 + fnName.length + 2 + power.length + argChar.length;
            let left = textBefore.substring(0, textBefore.length - matchedLen);
            let right = textAfter.substring(2);
            math.value = left + `\\${fnName}^{${power}}{${argChar}` + right;
            newCursor = left.length + 1 + fnName.length + 4 + power.length + argChar.length;
            replaced = true;
        }
    }

    // Rule B: Exit argument group when operator typed inside function arg with power
    // e.g. typing '+' in \sin^{2}{x+} → moves operator outside: \sin^{2}{x}+
    let funcPowerArgOpMatch = textBefore.match(/\\(sin|cos|tan|sinh|cosh|tanh|ln|log|exp|sec|csc|cosec|cot|sech|csch|cosech|coth)\^\{([^}]+)\}\{([^}]+)([+\-*/=])$/);
    if (!replaced && funcPowerArgOpMatch) {
        let fnName = funcPowerArgOpMatch[1];
        let power = funcPowerArgOpMatch[2];
        let argContent = funcPowerArgOpMatch[3];
        let op = funcPowerArgOpMatch[4];
        let textAfter = math.value.substring(pos);
        if (textAfter.startsWith('}') && !argContent.includes('\\')) {
            let matchedStr = `\\${fnName}^{${power}}{${argContent}${op}`;
            let left = textBefore.substring(0, textBefore.length - matchedStr.length);
            let right = textAfter.substring(1);
            math.value = left + `\\${fnName}^{${power}}{${argContent}}${op}` + right;
            newCursor = left.length + 1 + fnName.length + 4 + power.length + argContent.length + 2;
            replaced = true;
        }
    }

    // Rule C: Exit argument group when operator typed inside function arg (no power)
    // e.g. typing '+' in \sin{x+} → moves operator outside: \sin{x}+
    // Guard: skip if arg starts with '(' (user is building a parenthesised arg like sin(x+1))
    let funcNoArgOpMatch = textBefore.match(/\\(sin|cos|tan|sinh|cosh|tanh|ln|log|exp|sec|csc|cosec|cot|sech|csch|cosech|coth)\{([^}]+)([+\-*/=])$/);
    if (!replaced && funcNoArgOpMatch) {
        let fnName = funcNoArgOpMatch[1];
        let argContent = funcNoArgOpMatch[2];
        let op = funcNoArgOpMatch[3];
        let textAfter = math.value.substring(pos);
        if (textAfter.startsWith('}') && !argContent.startsWith('(') && !argContent.includes('\\')) {
            let matchedStr = `\\${fnName}{${argContent}${op}`;
            let left = textBefore.substring(0, textBefore.length - matchedStr.length);
            let right = textAfter.substring(1);
            math.value = left + `\\${fnName}{${argContent}}${op}` + right;
            newCursor = left.length + 1 + fnName.length + 1 + argContent.length + 2;
            replaced = true;
        }
    }

    // Typing ')' inside template groups
    if (!replaced && textBefore.endsWith(')')) {
        const { template, partIndex } = getInnermostTemplatePart(math.value, pos - 1);
        if (template && partIndex !== -1) {
            let part = template.parts[partIndex];
            let partText = math.value.substring(part.start, pos - 1);
            let openCount = (partText.match(/\(/g) || []).length;
            let closeCount = (partText.match(/\)/g) || []).length;
            if (openCount <= closeCount) {
                // Move the ')' to the end of the template
                let left = math.value.substring(0, pos - 1);
                let middle = math.value.substring(pos, template.end);
                let right = math.value.substring(template.end);
                math.value = left + middle + ')' + right;
                newCursor = left.length + middle.length + 1;
                replaced = true;
            }
        } else {
            // Typing ')' to exit a group if followed by '}'
            let textAfter = math.value.substring(pos);
            if (textAfter.startsWith('}')) {
                let left = textBefore.substring(0, textBefore.length - 1);
                math.value = left + '}' + ')' + textAfter.substring(1);
                newCursor = left.length + 2;
                replaced = true;
            }
        }
    }

    if (!replaced && textBefore.endsWith('^')) {
        math.value = math.value.substring(0, pos - 1) + '^{}' + math.value.substring(pos);
        newCursor = pos - 1 + 2;
        replaced = true;
    }
    else if (!replaced && textBefore.endsWith('_')) {
        math.value = math.value.substring(0, pos - 1) + '_{}' + math.value.substring(pos);
        newCursor = pos - 1 + 2;
        replaced = true;
    }

    // Greek Symbols Autocomplete
    const GREEK_SYMBOLS = {
        'alpha': '\\alpha', 'beta': '\\beta', 'gamma': '\\gamma', 'delta': '\\delta',
        'epsilon': '\\epsilon', 'zeta': '\\zeta', 'eta': '\\eta', 'theta': '\\theta',
        'iota': '\\iota', 'kappa': '\\kappa', 'lambda': '\\lambda', 'mu': '\\mu',
        'nu': '\\nu', 'xi': '\\xi', 'omicron': 'o', 'pi': '\\pi', 'rho': '\\rho',
        'sigma': '\\sigma', 'tau': '\\tau', 'upsilon': '\\upsilon', 'phi': '\\phi',
        'chi': '\\chi', 'psi': '\\psi', 'omega': '\\omega', 'infty': '\\infty',

        'capalpha': 'A', 'capbeta': 'B', 'capgamma': '\\Gamma', 'capdelta': '\\Delta',
        'capepsilon': 'E', 'capzeta': 'Z', 'capeta': 'H', 'captheta': '\\Theta',
        'capiota': 'I', 'capkappa': 'K', 'caplambda': '\\Lambda', 'capmu': 'M',
        'capnu': 'N', 'capxi': '\\Xi', 'capomicron': 'O', 'cappi': '\\Pi',
        'caprho': 'P', 'capsigma': '\\Sigma', 'captau': 'T', 'capupsilon': '\\Upsilon',
        'capphi': '\\Phi', 'capchi': 'X', 'cappsi': '\\Psi', 'capomega': '\\Omega'
    };
    let greekMatch = textBefore.match(/(?:^|[^a-zA-Z])(cap[a-zA-Z]+|[a-zA-Z]+)$/i);
    if (!replaced && greekMatch) {
        let word = greekMatch[1].toLowerCase();
        if (GREEK_SYMBOLS.hasOwnProperty(word)) {
            let latexSym = GREEK_SYMBOLS[word];
            let wordStart = pos - greekMatch[1].length;
            math.value = math.value.substring(0, wordStart) + latexSym + math.value.substring(pos);
            newCursor = wordStart + latexSym.length;
            replaced = true;
        }
    }

    // Relation Operators Autocomplete
    if (!replaced && textBefore.endsWith('<=')) {
        math.value = math.value.substring(0, pos - 2) + '\\le ' + math.value.substring(pos);
        newCursor = pos - 2 + 4;
        replaced = true;
    }
    else if (!replaced && textBefore.endsWith('>=')) {
        math.value = math.value.substring(0, pos - 2) + '\\ge ' + math.value.substring(pos);
        newCursor = pos - 2 + 4;
        replaced = true;
    }
    else if (!replaced && textBefore.endsWith('approx=')) {
        math.value = math.value.substring(0, pos - 7) + '\\approx ' + math.value.substring(pos);
        newCursor = pos - 7 + 8;
        replaced = true;
    }

    // Standard Math Functions Autocomplete
    if (!replaced && textBefore.endsWith('sqrt')) {
        math.value = math.value.substring(0, pos - 4) + '\\sqrt{}' + math.value.substring(pos);
        newCursor = pos - 4 + 6;
        replaced = true;
    }
    else if (!replaced && textBefore.endsWith('nrt')) {
        math.value = math.value.substring(0, pos - 3) + '\\sqrt[]{}' + math.value.substring(pos);
        newCursor = pos - 3 + 6;
        replaced = true;
    }
    else if (!replaced && textBefore.endsWith('sinh')) {
        math.value = math.value.substring(0, pos - 4) + '\\sinh{}' + math.value.substring(pos);
        newCursor = pos - 4 + 6;
        replaced = true;
    }
    else if (!replaced && textBefore.endsWith('cosh')) {
        math.value = math.value.substring(0, pos - 4) + '\\cosh{}' + math.value.substring(pos);
        newCursor = pos - 4 + 6;
        replaced = true;
    }
    else if (!replaced && textBefore.endsWith('tanh')) {
        math.value = math.value.substring(0, pos - 4) + '\\tanh{}' + math.value.substring(pos);
        newCursor = pos - 4 + 6;
        replaced = true;
    }
    else if (!replaced && textBefore.endsWith('cosec')) {
        if (!textBefore.endsWith('acosec') && !textBefore.endsWith('cosech')) {
            math.value = math.value.substring(0, pos - 5) + '\\csc{}' + math.value.substring(pos);
            newCursor = pos - 5 + 5;
            replaced = true;
        }
    }
    else if (!replaced && textBefore.endsWith('csc')) {
        if (!textBefore.endsWith('acsc') && !textBefore.endsWith('csch') && !textBefore.endsWith('cosec')) {
            math.value = math.value.substring(0, pos - 3) + '\\csc{}' + math.value.substring(pos);
            newCursor = pos - 3 + 5;
            replaced = true;
        }
    }
    else if (!replaced && textBefore.endsWith('sec')) {
        if (!textBefore.endsWith('asec') && !textBefore.endsWith('sech') && !textBefore.endsWith('cosec')) {
            math.value = math.value.substring(0, pos - 3) + '\\sec{}' + math.value.substring(pos);
            newCursor = pos - 3 + 5;
            replaced = true;
        }
    }
    else if (!replaced && textBefore.endsWith('cot')) {
        if (!textBefore.endsWith('acot') && !textBefore.endsWith('coth')) {
            math.value = math.value.substring(0, pos - 3) + '\\cot{}' + math.value.substring(pos);
            newCursor = pos - 3 + 5;
            replaced = true;
        }
    }
    else if (!replaced && textBefore.endsWith('cosech')) {
        math.value = math.value.substring(0, pos - 6) + '\\csch{}' + math.value.substring(pos);
        newCursor = pos - 6 + 6;
        replaced = true;
    }
    else if (!replaced && textBefore.endsWith('csch')) {
        if (!textBefore.endsWith('acsch') && !textBefore.endsWith('cosech')) {
            math.value = math.value.substring(0, pos - 4) + '\\csch{}' + math.value.substring(pos);
            newCursor = pos - 4 + 6;
            replaced = true;
        }
    }
    else if (!replaced && textBefore.endsWith('sech')) {
        if (!textBefore.endsWith('asech')) {
            math.value = math.value.substring(0, pos - 4) + '\\sech{}' + math.value.substring(pos);
            newCursor = pos - 4 + 6;
            replaced = true;
        }
    }
    else if (!replaced && textBefore.endsWith('coth')) {
        if (!textBefore.endsWith('acoth')) {
            math.value = math.value.substring(0, pos - 4) + '\\coth{}' + math.value.substring(pos);
            newCursor = pos - 4 + 6;
            replaced = true;
        }
    }
    else if (!replaced && textBefore.endsWith('acosec')) {
        math.value = math.value.substring(0, pos - 6) + '\\csc^{-1}{}' + math.value.substring(pos);
        newCursor = pos - 6 + 10;
        replaced = true;
    }
    else if (!replaced && textBefore.endsWith('asec')) {
        math.value = math.value.substring(0, pos - 4) + '\\sec^{-1}{}' + math.value.substring(pos);
        newCursor = pos - 4 + 10;
        replaced = true;
    }
    else if (!replaced && textBefore.endsWith('acsc')) {
        if (!textBefore.endsWith('acsch')) {
            math.value = math.value.substring(0, pos - 4) + '\\csc^{-1}{}' + math.value.substring(pos);
            newCursor = pos - 4 + 10;
            replaced = true;
        }
    }
    else if (!replaced && textBefore.endsWith('acot')) {
        if (!textBefore.endsWith('acoth')) {
            math.value = math.value.substring(0, pos - 4) + '\\cot^{-1}{}' + math.value.substring(pos);
            newCursor = pos - 4 + 10;
            replaced = true;
        }
    }
    else if (!replaced && textBefore.endsWith('sin')) {
        if (!textBefore.endsWith('asin') && !textBefore.endsWith('sinh')) {
            math.value = math.value.substring(0, pos - 3) + '\\sin{}' + math.value.substring(pos);
            newCursor = pos - 3 + 5;
            replaced = true;
        }
    }
    else if (!replaced && textBefore.endsWith('cos')) {
        if (!textBefore.endsWith('acos') && !textBefore.endsWith('cosh')) {
            math.value = math.value.substring(0, pos - 3) + '\\cos{}' + math.value.substring(pos);
            newCursor = pos - 3 + 5;
            replaced = true;
        }
    }
    else if (!replaced && textBefore.endsWith('tan')) {
        if (!textBefore.endsWith('atan') && !textBefore.endsWith('tanh')) {
            math.value = math.value.substring(0, pos - 3) + '\\tan{}' + math.value.substring(pos);
            newCursor = pos - 3 + 5;
            replaced = true;
        }
    }
    else if (!replaced && textBefore.endsWith('ln')) {
        math.value = math.value.substring(0, pos - 2) + '\\ln{}' + math.value.substring(pos);
        newCursor = pos - 2 + 4;
        replaced = true;
    }
    else if (!replaced && textBefore.endsWith('log')) {
        math.value = math.value.substring(0, pos - 3) + '\\log_{}{} ' + math.value.substring(pos);
        newCursor = pos - 3 + 6;
        replaced = true;
    }
    else if (!replaced && textBefore.endsWith('dho')) {
        math.value = math.value.substring(0, pos - 3) + '\\partial ' + math.value.substring(pos);
        newCursor = pos - 3 + 9;
        replaced = true;
    }
    else if (!replaced && textBefore.endsWith('asin')) {
        math.value = math.value.substring(0, pos - 4) + '\\sin^{-1}{}' + math.value.substring(pos);
        newCursor = pos - 4 + 10;
        replaced = true;
    }
    else if (!replaced && textBefore.endsWith('acos')) {
        math.value = math.value.substring(0, pos - 4) + '\\cos^{-1}{}' + math.value.substring(pos);
        newCursor = pos - 4 + 10;
        replaced = true;
    }
    else if (!replaced && textBefore.endsWith('atan')) {
        math.value = math.value.substring(0, pos - 4) + '\\tan^{-1}{}' + math.value.substring(pos);
        newCursor = pos - 4 + 10;
        replaced = true;
    }
    else if (!replaced && textBefore.endsWith('/')) {
        let extracted = extractNumeratorBeforeSlash(textBefore);
        let term = extracted.term;
        let remaining = extracted.remaining;

        math.value = remaining + '\\frac{' + term + '}{}' + math.value.substring(pos);
        newCursor = remaining.length + 6 + term.length + 2; // right inside the denominator '{'
        replaced = true;
    }

    if (replaced) {
        if (textBefore.endsWith('bmatrix')) {
            math.setSelectionRange(newCursor, newCursor + 1);
        } else {
            math.setSelectionRange(newCursor, newCursor);
        }
    }

    // Auto-detect complex patterns to activate button (without inserting template)
    function detectComplexNumberPattern(str) {
        const patterns = [
            /[a-zA-Z0-9]+\s*[+-]\s*\d*i\b/, // a+bi, a+i, 3+2i
            /[a-zA-Z0-9]+\s*[+-]\s*i\([^)]+\)/, // a+i(b)
            /\d*i\s*[+-]\s*[a-zA-Z0-9]+/, // bi+a, i+a
            /i\([^)]+\)\s*[+-]\s*[a-zA-Z0-9]+/, // i(b)+a
            /\b\d+i\b/, // ki (e.g. 5i)
            /\bi[a-zA-Z]\b/, // ia
            /\b[a-zA-Z]i\b/, // ai
            /\bi\([^)]+\)/ // i(b)
        ];
        return patterns.some(p => p.test(str));
    }

    if (detectComplexNumberPattern(math.value)) {
        const complexBtn = document.getElementById('sym-complex');
        if (complexBtn && !complexBtn.classList.contains('active')) {
            setSymbolMode('complex', true); // skipInsert = true
        }
    }

    // Auto-expand bracket [val ] to bmatrix if space is typed after a single value
    let bracketMatch = math.value.match(/\[([^\[\]&#\\]+)(?:\\)?\s+\]/);
    if (bracketMatch) {
        let content = bracketMatch[1].trim();
        if (content && !content.includes('hat') && !content.includes('\\hat') && !/[ijk]/.test(content)) {
            let origVal = math.value;
            let matchStr = bracketMatch[0];
            let matchIdx = origVal.indexOf(matchStr);
            let replaceStr = `\\begin{bmatrix}${content} & _ & _\\end{bmatrix}`;

            isProgrammaticUpdate = true;
            math.value = origVal.substring(0, matchIdx) + replaceStr + origVal.substring(matchIdx + matchStr.length);

            // Set cursor at the first placeholder '_'
            let firstUnder = replaceStr.indexOf('_');
            newCursor = matchIdx + firstUnder;
            math.setSelectionRange(newCursor, newCursor + 1); // select the '_'
            isProgrammaticUpdate = false;
        }
    }

    // Call sync on the current math value
    let synced = syncNormalize(math.value, math.selectionStart);
    synced = syncAngle(synced.val, synced.cursor);
    if (synced.val !== math.value) {
        isProgrammaticUpdate = true;
        math.value = synced.val;
        math.setSelectionRange(synced.cursor, synced.cursor);
        isProgrammaticUpdate = false;
    }

    ode.value = translateLatexToNerdamer(math.value);

    // Resize math and sync to ode and overlay
    resizeTextarea(math);
    if (ode) {
        ode.style.width = math.style.width;
        ode.style.height = math.style.height;
    }
    const overlayEl = document.getElementById("ode-math-overlay");
    if (overlayEl) {
        overlayEl.style.width = `calc(${math.style.width || '100%'} - 4px)`;
        overlayEl.style.height = `calc(${math.style.height || '60px'} - 4px)`;
    }

    onSelectionChange('forward');

    ode.dispatchEvent(new Event('input'));

    lastMathValue = math.value;
    lastOdeValue = ode.value;
}

function mapOdeToLatex(odeVal) {
    if (!odeVal) return "";
    try {
        return katexFormat(odeVal);
    } catch (e) {
        return odeVal;
    }
}

function toolkitBackspace() {
    const ode = document.getElementById("ode");
    const math = document.getElementById("math");
    if (!ode) return;

    if (math && math.style.display !== 'none') {
        if (tryDeleteLatexCommand(math)) {
            math.focus();
            math.dispatchEvent(new Event('input'));
            return;
        }

        const start = math.selectionStart;
        const end = math.selectionEnd;
        const value = math.value;

        isProgrammaticUpdate = true;
        if (start !== end) {
            math.value = value.substring(0, start) + value.substring(end);
            math.setSelectionRange(start, start);
        } else if (start > 0) {
            math.value = value.substring(0, start - 1) + value.substring(start);
            math.setSelectionRange(start - 1, start - 1);
        }
        isProgrammaticUpdate = false;

        const odeStart = mapMathCursorToOde(value, ode.value, start);
        const odeEnd = mapMathCursorToOde(value, ode.value, end);
        if (odeStart !== odeEnd) {
            ode.value = ode.value.substring(0, odeStart) + ode.value.substring(odeEnd);
            ode.setSelectionRange(odeStart, odeStart);
        } else if (odeStart > 0) {
            ode.value = ode.value.substring(0, odeStart - 1) + ode.value.substring(odeStart);
            ode.setSelectionRange(odeStart - 1, odeStart - 1);
        }

        math.focus();
        math.dispatchEvent(new Event('input'));
        ode.dispatchEvent(new Event('input'));
    } else {
        const start = ode.selectionStart;
        const end = ode.selectionEnd;
        const value = ode.value;
        if (start !== end) {
            ode.value = value.substring(0, start) + value.substring(end);
            ode.setSelectionRange(start, start);
        } else if (start > 0) {
            ode.value = value.substring(0, start - 1) + value.substring(start);
            ode.setSelectionRange(start - 1, start - 1);
        }
        ode.focus();
        ode.dispatchEvent(new Event('input'));
    }
}

function toggleFunctionsPanel() {
    const panel = document.getElementById("functions-panel");
    const fxBtn = document.getElementById("fx-btn");
    if (!panel) return;
    if (panel.style.display === "none") {
        panel.style.display = "grid";
        if (fxBtn) fxBtn.classList.add("active");
        // Close more-panel if open
        const morePanel = document.getElementById("more-panel");
        const moreBtn = document.getElementById("more-btn");
        if (morePanel && morePanel.style.display !== "none") {
            morePanel.style.display = "none";
            const tools = document.getElementById("tools");
            if (tools) tools.classList.remove("wide");
            if (moreBtn) moreBtn.classList.remove("active");
            // Cleanly deactivate all symbol modes and close subpanels
            MORE_SYMBOL_IDS.forEach(id => {
                const btn = document.getElementById(id);
                if (btn) btn.classList.remove('active');
            });
            showSubPanel(null);
        }
    } else {
        panel.style.display = "none";
        if (fxBtn) fxBtn.classList.remove("active");

        // On mobile, if we close functions-panel, show more-panel Page 1 as fallback
        if (window.innerWidth <= 600) {
            const morePanel = document.getElementById("more-panel");
            if (morePanel) {
                morePanel.style.display = "flex";
                morePanel.classList.remove('mobile-sym-page');
                const moreBtn = document.getElementById("more-btn");
                if (moreBtn) moreBtn.classList.remove('active');
            }
        }
    }
}

/* ── Mobile toolkit initialisation ──────────────────────────────────────
   Tag the two operators-grid divs inside #more-panel so CSS can target
   them independently (nums grid vs ops grid) without touching the HTML.
   Called once after DOM ready and on resize.
───────────────────────────────────────────────────────────────────────── */
function initMobileToolkit() {
    if (window.innerWidth > 600) return;
    const morePanel = document.getElementById('more-panel');
    if (!morePanel) return;
    const content = morePanel.querySelector('.more-panel-content');
    if (!content) return;
    const grids = content.querySelectorAll(':scope > .operators-grid');
    if (grids[0] && !grids[0].classList.contains('mobile-nums-grid')) {
        grids[0].classList.add('mobile-nums-grid');
    }
    if (grids[1] && !grids[1].classList.contains('mobile-ops-grid')) {
        grids[1].classList.add('mobile-ops-grid');
    }
}

function toggleMoreFunctions() {
    const panel = document.getElementById("more-panel");
    const moreBtn = document.getElementById("more-btn");
    if (!panel) return;

    // ── Mobile (≤600px): switch between page 1 (nums+ops) and page 2 (symbols) ──
    if (window.innerWidth <= 600) {
        // Close functions-panel first if open
        const fxPanel = document.getElementById("functions-panel");
        const fxBtn = document.getElementById("fx-btn");
        if (fxPanel && fxPanel.style.display !== "none") {
            fxPanel.style.display = "none";
            if (fxBtn) fxBtn.classList.remove("active");

            // Show more-panel and ensure it is Page 1 (default)
            panel.style.display = "flex";
            panel.classList.remove('mobile-sym-page');
            if (moreBtn) moreBtn.classList.remove('active');
            showSubPanel(null);
            MORE_SYMBOL_IDS.forEach(id => {
                const btn = document.getElementById(id);
                if (btn) btn.classList.remove('active');
            });
            return;
        }

        // Otherwise, toggle pages
        const isSymPage = panel.classList.contains('mobile-sym-page');
        if (isSymPage) {
            // Back to page 1 (nums + ops)
            panel.classList.remove('mobile-sym-page');
            if (moreBtn) moreBtn.classList.remove('active');
            showSubPanel(null);
            MORE_SYMBOL_IDS.forEach(id => {
                const btn = document.getElementById(id);
                if (btn) btn.classList.remove('active');
            });
        } else {
            // Go to page 2 (all symbol subpanels)
            panel.classList.add('mobile-sym-page');
            if (moreBtn) moreBtn.classList.add('active');
            // Select matrix tab by default
            setSymbolMode('matrix');
        }
        return;
    }

    // ── Desktop: show/hide symbols panel ──
    const tools = document.getElementById("tools");
    const isSymbolsActive = panel.classList.contains("show-symbols");
    if (!isSymbolsActive) {
        panel.classList.add("show-symbols");
        if (tools) tools.classList.add("wide");
        if (moreBtn) moreBtn.classList.add("active");
        // Close functions-panel if open
        const fxPanel = document.getElementById("functions-panel");
        const fxBtn = document.getElementById("fx-btn");
        if (fxPanel && fxPanel.style.display !== "none") {
            fxPanel.style.display = "none";
            if (fxBtn) fxBtn.classList.remove("active");
        }
        // Ensure one of the symbol subpanels is active by default on desktop too
        let activeId = null;
        if (document.getElementById('sym-complex') && document.getElementById('sym-complex').classList.contains('active')) activeId = 'complex';
        else if (document.getElementById('sym-vector') && document.getElementById('sym-vector').classList.contains('active')) activeId = 'vector';
        else if (document.getElementById('sym-matrix') && document.getElementById('sym-matrix').classList.contains('active')) activeId = 'matrix';
        setSymbolMode(activeId || 'matrix');
    } else {
        panel.classList.remove("show-symbols");
        if (tools) tools.classList.remove("wide");
        if (moreBtn) moreBtn.classList.remove("active");
        // Cleanly deactivate all symbol modes and close subpanels
        MORE_SYMBOL_IDS.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.classList.remove('active');
        });
        showSubPanel(null);
    }
}

function laTeXDisplay(type) {
    let insertText = '';
    let rows = 2, cols = 2;
    let sizeCancelled = false;

    const isMobile = window.innerWidth <= 600;

    if (isMobile && (type === 'matrix_template' || type === 'matrix_identity' || type === 'matrix_null')) {
        let defaultPromptVal = "2x2";
        let promptMsg = "Enter matrix size (e.g. 3x3 or 3):";
        if (type === 'matrix_identity') {
            defaultPromptVal = "2";
            promptMsg = "Enter identity matrix size (e.g. 3):";
        }
        let size = prompt(promptMsg, defaultPromptVal);
        if (size === null) {
            sizeCancelled = true;
        } else {
            let cleanSize = size.trim().toLowerCase().replace(/\\times/g, '*');
            let valid = false;
            if (/^\d+$/.test(cleanSize)) {
                rows = parseInt(cleanSize);
                cols = rows;
                valid = true;
            } else {
                let parts = cleanSize.split(/[\*x,]/);
                if (parts.length === 2 && /^\d+$/.test(parts[0].trim()) && /^\d+$/.test(parts[1].trim())) {
                    rows = parseInt(parts[0].trim());
                    cols = parseInt(parts[1].trim());
                    valid = true;
                }
            }
            if (!valid || rows <= 0 || cols <= 0) {
                rows = 2;
                cols = 2;
            }
        }
    }

    if (sizeCancelled) return;

    switch (type) {
        case 'int': insertText = 'integrate( , x)'; break;
        case 'intab': insertText = 'defint( , a, b, x)'; break;
        case 'diff': insertText = 'diff( , x)'; break;
        case 'diffn': insertText = 'diff( , x, n)'; break;
        case 'limit': insertText = 'limit( , x, 0)'; break;
        case 'sum': insertText = 'sum( , x, 1, 10)'; break;
        case 'prod': insertText = 'product( , x, 1, 10)'; break;
        case 'sqrt': insertText = 'sqrt()'; break;
        case 'nrt': insertText = 'nrt( , )'; break;
        case 'abs': insertText = 'abs()'; break;
        case 'fact': insertText = 'fact()'; break;
        case 'by': insertText = 'x/y'; break;
        case 'sin': insertText = 'sin()'; break;
        case 'cos': insertText = 'cos()'; break;
        case 'tan': insertText = 'tan()'; break;
        case 'asin': insertText = 'asin()'; break;
        case 'acos': insertText = 'acos()'; break;
        case 'atan': insertText = 'atan()'; break;
        case 'sinh': insertText = 'sinh()'; break;
        case 'cosh': insertText = 'cosh()'; break;
        case 'tanh': insertText = 'tanh()'; break;
        case 'ln': insertText = 'ln()'; break;
        case 'log': insertText = 'log( , )'; break;
        case 'exp': insertText = 'exp()'; break;
        case 'laplace': insertText = 'laplace( , t, s)'; break;
        case 'invlaplace': insertText = 'ilaplace( , s, t)'; break;
        case 'complex': insertText = 'a+b*i'; break;
        case 'matrix': insertText = 'matrix([1,0],[0,1])'; break;
        case 'vector': insertText = 'vector(1, 0, 0)'; break;
        case 'complex_conj': insertText = 'conjugate()'; break;
        case 'complex_mod': insertText = 'abs()'; break;
        case 'complex_arg': insertText = 'arg()'; break;
        case 'complex_real': insertText = 'realpart()'; break;
        case 'complex_imag': insertText = 'imagpart()'; break;
        case 'complex_polar': insertText = 'polarform()'; break;
        case 'complex_rect': insertText = 'rectform()'; break;
        case 'vector_mag': insertText = 'mag()'; break;
        case 'vector_normalize': insertText = 'normalize()'; break;
        case 'vector_angle': insertText = 'angle( , )'; break;
        case 'vector_1x3': insertText = '[1,0,0]'; break;
        case 'vector_dot': insertText = 'dot( , )'; break;
        case 'vector_cross': insertText = 'cross( , )'; break;
        case 'matrix_template':
            if (isMobile) {
                let rowsArr = [];
                for (let r = 0; r < rows; r++) {
                    let colArr = Array(cols).fill('0');
                    rowsArr.push(`[${colArr.join(',')}]`);
                }
                insertText = `matrix(${rowsArr.join(',')})`;
            } else {
                insertText = 'matrix([1,0],[0,1])';
            }
            break;
        case 'matrix_transpose': insertText = 'transpose()'; break;
        case 'matrix_det': insertText = 'det()'; break;
        case 'matrix_inverse': insertText = 'invert()'; break;
        case 'matrix_identity':
            if (isMobile) {
                let rowsArr = [];
                for (let r = 0; r < rows; r++) {
                    let colArr = Array(cols).fill('0');
                    if (r < cols) colArr[r] = '1';
                    rowsArr.push(`[${colArr.join(',')}]`);
                }
                insertText = `matrix(${rowsArr.join(',')})`;
            } else {
                insertText = 'identity()';
            }
            break;
        case 'matrix_null':
            if (isMobile) {
                let rowsArr = [];
                for (let r = 0; r < rows; r++) {
                    let colArr = Array(cols).fill('0');
                    rowsArr.push(`[${colArr.join(',')}]`);
                }
                insertText = `matrix(${rowsArr.join(',')})`;
            } else {
                insertText = 'null()';
            }
            break;
        case 'matrix_eigenvalues': insertText = 'eigenvalues()'; break;
        case 'matrix_eigenvectors': insertText = 'eigenvectors()'; break;
        case 'matrix_rref': insertText = 'rref()'; break;
        case 'matrix_basis': insertText = 'basis()'; break;
        default:
            insertText = type;
            break;
    }

    const textarea = document.getElementById("ode");
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;

    textarea.value = value.substring(0, start) + insertText + value.substring(end);

    let newCursorPos = start + insertText.length;
    if (insertText.endsWith('()')) {
        newCursorPos = start + insertText.length - 1;
    } else if (insertText.includes('( ,')) {
        let openParenIdx = insertText.indexOf('(');
        newCursorPos = start + openParenIdx + 2; // right after (
    }

    textarea.focus();
    textarea.setSelectionRange(newCursorPos, newCursorPos);

    textarea.dispatchEvent(new Event('input'));

    const mathTextarea = document.getElementById("math");
    if (mathTextarea && mathTextarea.style.display !== 'none') {
        kaTeXDisplay(type, rows, cols);
    }
}

function kaTeXDisplay(type, rows = 2, cols = 2) {
    let insertText = '';
    const isMobile = window.innerWidth <= 600;

    switch (type) {
        case 'int': insertText = '\\int {}\\, dx'; break;
        case 'intab': insertText = '\\int_{}^{} {}\\, dx'; break;
        case 'diff': insertText = '\\frac{d}{dx} {}'; break;
        case 'diffn': insertText = '\\frac{d^{} {}}{dx^{}}'; break;
        case 'limit': insertText = '\\lim_{x \\to 0} {}'; break;
        case 'sum': insertText = '\\sum_{}^{} {}'; break;
        case 'prod': insertText = '\\prod_{}^{} {}'; break;
        case 'sqrt': insertText = '\\sqrt{}'; break;
        case 'nrt': insertText = '\\sqrt[]{}'; break;
        case 'abs': insertText = '\\lvert {} \\rvert'; break;
        case 'fact': insertText = '\\left({}\\right)!'; break;
        case 'by': insertText = '\\frac{}{}'; break;
        case 'sin': insertText = '\\sin{}'; break;
        case 'cos': insertText = '\\cos{}'; break;
        case 'tan': insertText = '\\tan{}'; break;
        case 'asin': insertText = '\\sin^{-1}{}'; break;
        case 'acos': insertText = '\\cos^{-1}{}'; break;
        case 'atan': insertText = '\\tan^{-1}{}'; break;
        case 'sinh': insertText = '\\sinh{}'; break;
        case 'cosh': insertText = '\\cosh{}'; break;
        case 'tanh': insertText = '\\tanh{}'; break;
        case 'ln': insertText = '\\ln{}'; break;
        case 'log': insertText = '\\log_{}{}'; break;
        case 'exp': insertText = '\\exp{}'; break;
        case 'matrix': insertText = '\\begin{bmatrix}1 & 0 \\\\ 0 & 1\\end{bmatrix}'; break;
        case 'vector': insertText = '\\begin{bmatrix}1 & 0 & 0\\end{bmatrix}'; break;
        case 'complex': insertText = 'a+bi'; break;
        case 'laplace': insertText = '\\mathcal{L}\\left\\{_\\right\\}(s)'; break;
        case 'invlaplace': insertText = '\\mathcal{L}^{-1}\\left\\{_\\right\\}(t)'; break;
        case 'complex_conj': insertText = '\\text{conjugate}({})'; break;
        case 'complex_mod': insertText = '\\lvert {} \\rvert'; break;
        case 'complex_arg': insertText = '\\text{arg}({})'; break;
        case 'complex_real': insertText = '\\text{realpart}({})'; break;
        case 'complex_imag': insertText = '\\text{imagpart}({})'; break;
        case 'complex_polar': insertText = '\\text{polarform}({})'; break;
        case 'complex_rect': insertText = '\\text{rectform}({})'; break;
        case 'vector_mag': insertText = '\\text{mag}({})'; break;
        case 'vector_normalize': insertText = '\\text{normalize}({})'; break;
        case 'vector_angle': insertText = '\\text{angle}({}, {})'; break;
        case 'vector_1x3': insertText = '\\begin{bmatrix}1 & 0 & 0\\end{bmatrix}'; break;
        case 'vector_dot': insertText = '\\text{dot}({}, {})'; break;
        case 'vector_cross': insertText = '\\text{cross}({}, {})'; break;
        case 'matrix_template':
            if (isMobile) {
                let rowsArr = [];
                for (let r = 0; r < rows; r++) {
                    let colArr = Array(cols).fill('_');
                    rowsArr.push(colArr.join(' & '));
                }
                insertText = `\\begin{bmatrix}${rowsArr.join(' \\\\ ')}\\end{bmatrix}`;
            } else {
                insertText = '\\begin{bmatrix}\\end{bmatrix}_{_ \\times _}';
            }
            break;
        case 'matrix_transpose': insertText = '{}^T'; break;
        case 'matrix_det': insertText = '\\text{det}({})'; break;
        case 'matrix_inverse': insertText = '{}^{-1}'; break;
        case 'matrix_identity':
            if (isMobile) {
                let rowsArr = [];
                for (let r = 0; r < rows; r++) {
                    let colArr = Array(cols).fill('0');
                    if (r < cols) colArr[r] = '1';
                    rowsArr.push(colArr.join(' & '));
                }
                insertText = `\\begin{bmatrix}${rowsArr.join(' \\\\ ')}\\end{bmatrix}`;
            } else {
                insertText = '\\begin{bmatrix}I\\end{bmatrix}_{_ \\times _}';
            }
            break;
        case 'matrix_null':
            if (isMobile) {
                let rowsArr = [];
                for (let r = 0; r < rows; r++) {
                    let colArr = Array(cols).fill('0');
                    rowsArr.push(colArr.join(' & '));
                }
                insertText = `\\begin{bmatrix}${rowsArr.join(' \\\\ ')}\\end{bmatrix}`;
            } else {
                insertText = '\\begin{bmatrix}O\\end{bmatrix}_{_ \\times _}';
            }
            break;
        case 'matrix_eigenvalues': insertText = '\\text{eigenvalues}({})'; break;
        case 'matrix_eigenvectors': insertText = '\\text{eigenvectors}({})'; break;
        case 'matrix_rref': insertText = '\\text{rref}({})'; break;
        case 'matrix_basis': insertText = '\\text{basis}({})'; break;
        default:
            insertText = type;
            break;
    }

    const textarea = document.getElementById("math");
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;

    isProgrammaticUpdate = true;
    textarea.value = value.substring(0, start) + insertText + value.substring(end);

    let newCursorPos = start + insertText.length;
    let selectsOneChar = false;
    if (type === 'matrix_template' || type === 'matrix_identity' || type === 'matrix_null') {
        if (isMobile) {
            let firstUnder = insertText.indexOf('_');
            if (firstUnder !== -1) {
                newCursorPos = start + firstUnder;
                selectsOneChar = true;
            }
        } else {
            let subStart = insertText.indexOf('_{');
            let underIdx = insertText.indexOf('_', subStart + 2);
            newCursorPos = start + underIdx;
            selectsOneChar = true;
        }
    } else if (type === 'diffn') {
        newCursorPos = start + 9;
    } else if (type === 'nrt') {
        newCursorPos = start + 6;
    } else if (insertText.endsWith('{}')) {
        newCursorPos = start + insertText.length - 1;
    } else if (insertText.includes('{}')) {
        let openParenIdx = insertText.indexOf('{');
        newCursorPos = start + openParenIdx + 1; // right after {
    } else if (type === 'laplace' || type === 'invlaplace') {
        let underIdx = insertText.indexOf('_');
        newCursorPos = start + underIdx;
        selectsOneChar = true;
    }

    textarea.focus();
    if (selectsOneChar) {
        textarea.setSelectionRange(newCursorPos, newCursorPos + 1);
    } else {
        textarea.setSelectionRange(newCursorPos, newCursorPos);
    }

    textarea.dispatchEvent(new Event('input'));
    isProgrammaticUpdate = false;
}

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function () {
        const renders = {
            'integral': '\\int',
            'derivative': '\\frac{d}{dx}',
            'def_integral': '\\int_{a}^{b}',
            'order_derivative': '\\frac{d^n}{dx^n}',
            'limit': '\\lim_{x}',
            'sum': '\\sum',
            'product': '\\prod',
            'sqrt': '\\sqrt{\\phantom{x}}',
            'nrt': '\\sqrt[n]{\\phantom{x}}',
            'abs': '|x|',
            'fact': '\\ n!',
            'by': '\\frac{n}{d}',
            'plus': '+',
            'minus': '-',
            'times': '\\times',
            'divide': '\\div',
            'equals': '=',
            'num0': '0',
            'num1': '1',
            'num2': '2',
            'num3': '3',
            'num4': '4',
            'num5': '5',
            'num6': '6',
            'num7': '7',
            'num8': '8',
            'num9': '9',
            'dot': '.',
            'fun_sin': '\\sin',
            'fun_cos': '\\cos',
            'fun_tan': '\\tan',
            'fun_asin': '\\sin^{-1}',
            'fun_acos': '\\cos^{-1}',
            'fun_atan': '\\tan^{-1}',
            'fun_sinh': '\\sinh',
            'fun_cosh': '\\cosh',
            'fun_tanh': '\\tanh',
            'fun_ln': '\\ln',
            'fun_log': '\\log',
            'fun_exp': 'e^{x}',
            'fx-label': 'f(x)',
            'var-x': 'x',
            'var-y': 'y',
            'clear-label': '\\leftarrow',
            'sym_laplace': '\\mathcal{L}',
            'sym_invlaplace': '\\mathcal{L}^{-1}',
            'sym_complex': '\\mathbb{C}',
            'sym_matrix': '\\begin{bmatrix}\\cdot\\end{bmatrix}',
            'sym_vector': '\\vec{v}',
            'btn-vector-mag': '\\lvert \\vec{v} \\rvert',
            'btn-vector-normalize': '\\text{normalize}',
            'btn-vector-angle': '\\text{angle}',
            'btn-complex-conj': '\\bar{z}',
            'btn-complex-mod': '\\lvert z \\rvert',
            'btn-complex-arg': '\\text{arg}(z)',
            'btn-complex-real': '\\text{Re}(z)',
            'btn-complex-imag': '\\text{Im}(z)',
            'btn-complex-polar': '\\text{polar}',
            'btn-complex-rect': '\\text{rect}',
            'btn-vector-1x3': '\\begin{bmatrix}x & y & z\\end{bmatrix}',
            'btn-vector-dot': '\\vec{u} \\cdot \\vec{v}',
            'btn-vector-cross': '\\vec{u} \\times \\vec{v}',
            'btn-matrix-template': '\\begin{bmatrix}A\\end{bmatrix}',
            'btn-matrix-transpose': 'A^T',
            'btn-matrix-det': '\\det(A)',
            'btn-matrix-inverse': 'A^{-1}',
            'btn-matrix-identity': 'I',
            'btn-matrix-null': 'O',
            'btn-matrix-eigenvalues': '\\lambda',
            'btn-matrix-eigenvectors': '\\vec{v}_{\\lambda}',
            'btn-matrix-rref': '\\text{rref}(A)',
            'btn-matrix-basis': '\\text{basis}'
        };
        for (let id in renders) {
            let el = document.getElementById(id);
            if (el) {
                renderKatex(renders[id], el, { throwOnError: false });
            }
        }

        const math = document.getElementById("math");
        const ode = document.getElementById("ode");
        const overlay = document.getElementById("ode-math-overlay");

        if (math && ode) {
            math.addEventListener('input', handleMathInput);
            math.addEventListener('click', function () {
                onSelectionChange();
            });
            math.addEventListener('keyup', function (e) {
                let dir = undefined;
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') dir = 'forward';
                else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') dir = 'backward';
                onSelectionChange(dir);
            });
            math.addEventListener('select', function () {
                onSelectionChange();
            });
            math.addEventListener('focus', function () {
                onSelectionChange();
                const toolsBtn = document.querySelector('.tools-btn');
                const tools = document.getElementById('tools');
                if (toolsBtn && toolsBtn.classList.contains('active') && tools) {
                    tools.style.display = 'flex';
                }
            });
            math.addEventListener('keydown', function (e) {
                // Auto-select underscore placeholder when typing to overwrite it
                if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                    const pos = this.selectionStart;
                    const val = this.value;
                    if (pos === this.selectionEnd) {
                        if (val[pos] === '_' && val[pos + 1] !== '{') {
                            this.setSelectionRange(pos, pos + 1);
                        } else if (pos > 0 && val[pos - 1] === '_' && val[pos] !== '{') {
                            this.setSelectionRange(pos - 1, pos);
                        }
                    }
                }

                if (e.key === 'Enter') {
                    if (e.shiftKey) {
                        setTimeout(() => {
                            this.dispatchEvent(new Event('input'));
                        }, 0);
                    } else {
                        const pos = this.selectionStart;
                        const val = this.value;

                        // 1. Matrix Subscript Expansion Intercept
                        // Detect if cursor is ANYWHERE inside a matrix size subscript _{...}
                        // (not just at the end), so Enter expands even if cursor is mid-subscript.
                        let textBefore = val.substring(0, pos);
                        let textAfter = val.substring(pos);

                        // Find if cursor is inside a subscript dimension spec (e.g. _{2*2}).
                        // Guard: the segment between cursor and '}' must not contain '{' —
                        // that would mean we're inside a nested group, not at the subscript boundary.
                        let closingInAfter = textAfter.indexOf('}');
                        let isInsideSubscript = closingInAfter !== -1 &&
                            !textAfter.substring(0, closingInAfter).includes('{');

                        // Find the innermost matrix subscript before cursor using a direct scan.
                        // Key: use lastIndexOf for \end{matrixType}_{ so we always find the
                        // RIGHTMOST (most recent) matrix template — not the first one.
                        // This prevents earlier matrices from being eaten when two are present.
                        let matrixExpanded = false;
                        if (isInsideSubscript) {
                            const matrixTypes = ['bmatrix', 'vmatrix', 'matrix'];
                            let bestEndIdx = -1;
                            let bestMatrixType = null;

                            // Find the last occurring \end{X}_{ among all matrix types
                            for (let mt of matrixTypes) {
                                let endTag = `\\end{${mt}}_{`;
                                let idx = textBefore.lastIndexOf(endTag);
                                if (idx > bestEndIdx) {
                                    bestEndIdx = idx;
                                    bestMatrixType = mt;
                                }
                            }

                            if (bestEndIdx !== -1 && bestMatrixType !== null) {
                                let matrixType = bestMatrixType;
                                let beginTag = `\\begin{${matrixType}}`;
                                let endTagFull = `\\end{${matrixType}}_{`;
                                let endTagBody = `\\end{${matrixType}}`;

                                // Scan backwards from bestEndIdx to find the matching \begin{matrixType}
                                let depth = 1;
                                let bodyStart = -1;
                                let i = bestEndIdx - 1;
                                while (i >= 0 && depth > 0) {
                                    if (textBefore.substring(i).startsWith(endTagBody)) {
                                        depth++;
                                        i -= endTagBody.length;
                                    } else if (textBefore.substring(i).startsWith(beginTag)) {
                                        depth--;
                                        if (depth === 0) {
                                            bodyStart = i + beginTag.length;
                                        }
                                        i -= beginTag.length;
                                    } else {
                                        i--;
                                    }
                                }

                                if (bodyStart !== -1) {
                                    let matrixContent = textBefore.substring(bodyStart, bestEndIdx);
                                    let subscriptPartialStart = bestEndIdx + endTagFull.length;
                                    let subscriptPartial = textBefore.substring(subscriptPartialStart);
                                    let subscriptVal = subscriptPartial + textAfter.substring(0, closingInAfter);

                                    let rows = 1, cols = 1;
                                    let sub = subscriptVal.trim().toLowerCase();
                                    sub = sub.replace(/\\times/g, '*');
                                    let validSize = false;
                                    if (/^\d+$/.test(sub)) {
                                        rows = parseInt(sub);
                                        cols = rows;
                                        validSize = true;
                                    } else {
                                        let sizeParts = sub.split(/[\*x,]/);
                                        if (sizeParts.length === 2 && /^\d+$/.test(sizeParts[0].trim()) && /^\d+$/.test(sizeParts[1].trim())) {
                                            rows = parseInt(sizeParts[0].trim());
                                            cols = parseInt(sizeParts[1].trim());
                                            validSize = true;
                                        }
                                    }

                                    if (validSize) {
                                        e.preventDefault(); // Intercept!
                                        let newMatrix = '';
                                        if (matrixContent.trim() === 'I') {
                                            let rowsArr = [];
                                            for (let r = 0; r < rows; r++) {
                                                let colArr = Array(cols).fill('0');
                                                if (r < cols) colArr[r] = '1';
                                                rowsArr.push(colArr.join(' & '));
                                            }
                                            newMatrix = `\\begin{${matrixType}}` + rowsArr.join(' \\\\ ') + `\\end{${matrixType}}`;
                                        } else if (matrixContent.trim() === 'O') {
                                            let rowsArr = [];
                                            for (let r = 0; r < rows; r++) {
                                                let colArr = Array(cols).fill('0');
                                                rowsArr.push(colArr.join(' & '));
                                            }
                                            newMatrix = `\\begin{${matrixType}}` + rowsArr.join(' \\\\ ') + `\\end{${matrixType}}`;
                                        } else {
                                            let rowsArr = [];
                                            for (let r = 0; r < rows; r++) {
                                                let colArr = Array(cols).fill('_');
                                                rowsArr.push(colArr.join(' & '));
                                            }
                                            newMatrix = `\\begin{${matrixType}}` + rowsArr.join(' \\\\ ') + `\\end{${matrixType}}`;
                                        }

                                        // left = everything before the \begin{matrixType} of this template
                                        let left = textBefore.substring(0, bodyStart - beginTag.length);
                                        // right = everything after the closing } of the subscript
                                        let right = textAfter.substring(closingInAfter + 1);
                                        isProgrammaticUpdate = true;
                                        this.value = left + newMatrix + right;

                                        let nextCursor;
                                        let firstUnder = newMatrix.indexOf('_');
                                        if (firstUnder !== -1) {
                                            nextCursor = left.length + firstUnder;
                                            this.focus();
                                            this.setSelectionRange(nextCursor, nextCursor + 1);
                                        } else {
                                            nextCursor = left.length + newMatrix.length;
                                            this.focus();
                                            this.setSelectionRange(nextCursor, nextCursor);
                                        }

                                        this.dispatchEvent(new Event('input'));
                                        isProgrammaticUpdate = false;
                                        matrixExpanded = true;
                                    }
                                }
                            }
                        }
                        if (matrixExpanded) return;

                        // 2. Matrix Entry Navigation Intercept
                        // Look for next placeholder starting from cursor position
                        let nextUnderIdx = findNextPlaceholder(val, pos);
                        if (nextUnderIdx !== -1) {
                            e.preventDefault(); // Intercept!
                            selectPlaceholder(this, nextUnderIdx);
                            onSelectionChange();
                            return;
                        }

                        // If no more '_', try to jump out of the matrix
                        let endMatrixIdx = val.indexOf('\\end{', pos);
                        if (endMatrixIdx !== -1) {
                            let closingBraceIdx = val.indexOf('}', endMatrixIdx);
                            if (closingBraceIdx !== -1) {
                                e.preventDefault(); // Intercept!
                                this.setSelectionRange(closingBraceIdx + 1, closingBraceIdx + 1);
                                onSelectionChange();
                                return;
                            }
                        }

                        const { template, partIndex } = getInnermostTemplatePart(val, pos);
                        if (template && partIndex !== -1) {
                            e.preventDefault(); // Intercept!
                            let newCursorPos;
                            if (partIndex + 1 < template.parts.length) {
                                if (template.type === 'diffn' && partIndex === 0 && template.parts.length > 2) {
                                    newCursorPos = template.parts[2].start;
                                } else {
                                    newCursorPos = template.parts[partIndex + 1].start;
                                }
                            } else {
                                newCursorPos = template.end;
                            }
                            this.setSelectionRange(newCursorPos, newCursorPos);
                            onSelectionChange();
                            return;
                        }

                        // 3. Delimiter Jump Out Intercept
                        // Search for the nearest closing delimiter to the right of the cursor and jump past it.
                        // Checked delimiters: \right), \rvert, }, ), ]
                        let textAfterCursor = val.substring(pos);
                        let foundDelimiter = null;
                        let foundIndex = -1;
                        const delimiters = ['\\right)', '\\rvert', '}', ')', ']'];

                        for (let k = 0; k < textAfterCursor.length; k++) {
                            for (let delim of delimiters) {
                                if (textAfterCursor.substring(k).startsWith(delim)) {
                                    foundDelimiter = delim;
                                    foundIndex = pos + k;
                                    break;
                                }
                            }
                            if (foundDelimiter !== null) break;
                        }

                        if (foundDelimiter !== null) {
                            e.preventDefault(); // Intercept!
                            let nextCursorPos = foundIndex + foundDelimiter.length;
                            while (nextCursorPos <= val.length && !isAllowed(val, nextCursorPos)) {
                                nextCursorPos++;
                            }
                            this.setSelectionRange(nextCursorPos, nextCursorPos);
                            onSelectionChange();
                            return;
                        }

                        // Fallback: If no intercept matches, let the newline be inserted and trigger input resize
                        setTimeout(() => {
                            this.dispatchEvent(new Event('input'));
                        }, 0);
                    }
                }
                else if (e.key === 'Tab') {
                    const pos = this.selectionStart;
                    const val = this.value;
                    let nextUnderIdx = findNextPlaceholder(val, pos);
                    if (nextUnderIdx !== -1) {
                        e.preventDefault();
                        selectPlaceholder(this, nextUnderIdx);
                        onSelectionChange();
                        return;
                    }
                    const { template, partIndex } = getInnermostTemplatePart(val, pos);
                    if (template && partIndex !== -1) {
                        e.preventDefault();
                        let newCursorPos;
                        if (partIndex + 1 < template.parts.length) {
                            if (template.type === 'diffn' && partIndex === 0 && template.parts.length > 2) {
                                newCursorPos = template.parts[2].start;
                            } else {
                                newCursorPos = template.parts[partIndex + 1].start;
                            }
                        } else {
                            newCursorPos = template.end;
                        }
                        this.setSelectionRange(newCursorPos, newCursorPos);
                        onSelectionChange();
                    }
                }
                else if (e.key === ' ' || e.key === 'Spacebar') {
                    const pos = this.selectionStart;
                    const val = this.value;
                    let nextUnderIdx = findNextPlaceholder(val, pos);
                    if (nextUnderIdx !== -1) {
                        let segment = val.substring(pos, nextUnderIdx);
                        if (/^[\s&]*$/.test(segment)) {
                            e.preventDefault();
                            selectPlaceholder(this, nextUnderIdx);
                            onSelectionChange();
                            return;
                        }
                    }
                }
                else if (e.key === 'Backspace') {
                    // Whole-word delete for keywords that render as a single symbol
                    const KEYWORD_TOKENS = ['ilaplace', 'laplace'];
                    const bsPos = this.selectionStart;
                    const bsEnd = this.selectionEnd;
                    if (bsPos === bsEnd) {   // no selection — normal caret backspace
                        const textBefore = this.value.substring(0, bsPos);
                        let matched = null;
                        for (const kw of KEYWORD_TOKENS) {
                            if (textBefore.endsWith(kw)) {
                                matched = kw;
                                break;
                            }
                        }
                        if (matched) {
                            e.preventDefault();
                            const newPos = bsPos - matched.length;
                            this.value = this.value.substring(0, newPos) + this.value.substring(bsPos);
                            this.setSelectionRange(newPos, newPos);
                            this.dispatchEvent(new Event('input'));
                            return;
                        }
                    }
                    if (tryDeleteLatexCommand(this)) {
                        e.preventDefault();
                        this.dispatchEvent(new Event('input'));
                    }
                }
                else if (e.key === 'Delete') {
                    if (tryDeleteLatexCommandForward(this)) {
                        e.preventDefault();
                        this.dispatchEvent(new Event('input'));
                    }
                }
                else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                    setTimeout(() => {
                        onSelectionChange('forward');
                    }, 0);
                }
                else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    setTimeout(() => {
                        onSelectionChange('backward');
                    }, 0);
                }
            });

            ode.addEventListener('input', function () {
                const mathEl = document.getElementById("math");
                if (mathEl && mathEl.style.display !== 'none') {
                    return;
                }
                const overlayEl = document.getElementById("ode-math-overlay");
                math.style.width = this.style.width;
                math.style.height = this.style.height;
                if (overlayEl) {
                    overlayEl.style.width = `calc(${this.style.width || '100%'} - 4px)`;
                    overlayEl.style.height = `calc(${this.style.height || '60px'} - 4px)`;
                }
                const container = this.closest('.ode-input-container');
                if (container) {
                    container.style.width = this.style.width;
                }
            });
        }

        if (overlay && math) {
            overlay.addEventListener('click', function (e) {
                // Check if the click target is inside a matrix table cell
                const colEl = e.target.closest('.col-align-c, .col-align-l, .col-align-r');
                const mtable = colEl ? colEl.closest('.mtable') : null;

                if (colEl && mtable) {
                    const cols = Array.from(mtable.querySelectorAll('.col-align-c, .col-align-l, .col-align-r'));
                    const colIdx = cols.indexOf(colEl);

                    const cellWrapper = e.target.closest('.vlist > span');
                    if (cellWrapper && cellWrapper.parentElement) {
                        const vlist = cellWrapper.parentElement;
                        const children = Array.from(vlist.children).filter(child => {
                            return !child.classList.contains('vlist-s');
                        });
                        children.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
                        const rowIdx = children.indexOf(cellWrapper);

                        if (rowIdx !== -1 && colIdx !== -1) {
                            const mtables = Array.from(overlay.querySelectorAll('.mtable'));
                            const mtableIdx = mtables.indexOf(mtable);

                            const rawVal = math.value;
                            const matrixRegex = /\\begin\{(bmatrix|vmatrix|matrix)\}([\s\S]*?)\\end\{\1\}/g;
                            let match;
                            let matrices = [];
                            while ((match = matrixRegex.exec(rawVal)) !== null) {
                                matrices.push({
                                    start: match.index,
                                    end: matrixRegex.lastIndex,
                                    content: match[2],
                                    contentStart: match.index + match[0].indexOf(match[2])
                                });
                            }

                            if (mtableIdx !== -1 && mtableIdx < matrices.length) {
                                const clickedMatrix = matrices[mtableIdx];
                                const entries = getMatrixEntryRanges(clickedMatrix.content, clickedMatrix.contentStart);
                                const targetEntry = entries.find(ent => ent.row === rowIdx && ent.col === colIdx);
                                if (targetEntry) {
                                    math.focus();
                                    math.setSelectionRange(targetEntry.start, targetEntry.end);
                                    onSelectionChange();
                                    return;
                                }
                            }
                        }
                    }
                }

                // Fallback to percentage-based caret mapping
                const rect = overlay.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const targetLen = math.value.length;

                const katexEl = overlay.querySelector('.katex');
                let targetCursor;
                if (katexEl) {
                    const mathRect = katexEl.getBoundingClientRect();
                    const relativeClickX = e.clientX - mathRect.left;
                    let pct = relativeClickX / mathRect.width;
                    if (pct < 0) pct = 0;
                    if (pct > 1) pct = 1;
                    targetCursor = Math.round(pct * targetLen);
                } else {
                    const pct = clickX / rect.width;
                    targetCursor = Math.round(pct * targetLen);
                }

                targetCursor = getSafeCursor(math.value, targetCursor);

                math.focus();
                math.setSelectionRange(targetCursor, targetCursor);

                onSelectionChange();
            });
        }
    });
}
function preprocessTrigPowers(str) {
    if (!str || typeof str !== 'string') return str;

    const funcs = [
        'sinh', 'cosh', 'tanh', 'sech', 'csch', 'coth',
        'asinh', 'acosh', 'atanh', 'asech', 'acsch', 'acoth',
        'asin', 'acos', 'atan', 'asec', 'acsc', 'acot',
        'sin', 'cos', 'tan', 'sec', 'csc', 'cosec', 'cot',
        'ln', 'log',
        'cosech', 'acosec', 'acosech'
    ];

    const regex = new RegExp('\\b(' + funcs.join('|') + ')\\^', 'i');

    let res = str;
    let match;
    let iterations = 0;
    while ((match = res.match(regex)) && iterations < 100) {
        iterations++;
        let fn = match[1];
        let startIdx = match.index;
        let fnLen = fn.length;
        let caretIdx = startIdx + fnLen;

        let power = "";
        let nextIdx = caretIdx + 1;
        if (nextIdx < res.length && res[nextIdx] === '(') {
            let depth = 1;
            let j = nextIdx + 1;
            for (; j < res.length; j++) {
                if (res[j] === '(') depth++;
                else if (res[j] === ')') {
                    depth--;
                    if (depth === 0) break;
                }
            }
            if (depth === 0) {
                power = res.substring(nextIdx + 1, j);
                nextIdx = j + 1;
            } else {
                break;
            }
        } else {
            let j = nextIdx;
            if (/[0-9]/.test(res[j])) {
                // Consume digits and decimal points
                while (j < res.length && /[0-9\.]/.test(res[j])) {
                    j++;
                }
            } else if (/[a-zA-Z]/.test(res[j])) {
                // Consume a single letter
                j++;
            }
            power = res.substring(nextIdx, j);
            nextIdx = j;
        }

        if (!power) {
            break;
        }

        if (nextIdx < res.length && res[nextIdx] === '(') {
            let depth = 1;
            let j = nextIdx + 1;
            for (; j < res.length; j++) {
                if (res[j] === '(') depth++;
                else if (res[j] === ')') {
                    depth--;
                    if (depth === 0) break;
                }
            }
            if (depth === 0) {
                let arg = res.substring(nextIdx + 1, j);
                let replacement = `(( ${fn}(${arg}) )^(${power}))`;
                res = res.substring(0, startIdx) + replacement + res.substring(j + 1);
            } else {
                break;
            }
        } else {
            let j = nextIdx;
            while (j < res.length && /[a-zA-Z0-9\.]/.test(res[j])) {
                j++;
            }
            let arg = res.substring(nextIdx, j);
            if (!arg) arg = "x";
            let replacement = `(( ${fn}(${arg}) )^(${power}))`;
            res = res.substring(0, startIdx) + replacement + res.substring(j);
        }
    }
    return res;
}

function convertLeibnizToDiff(str) {
    if (!str || typeof str !== 'string') return str;
    let res = str;

    const highOrderRegex = /\bd\^([0-9]+)\/d([a-zA-Z])\^\1\s*\(/i;
    let match;
    while ((match = res.match(highOrderRegex))) {
        let order = match[1];
        let wrt = match[2];
        let startIdx = match.index;
        let matchLen = match[0].length;
        let argStart = startIdx + matchLen - 1;

        let depth = 1;
        let j = argStart + 1;
        for (; j < res.length; j++) {
            if (res[j] === '(') depth++;
            else if (res[j] === ')') {
                depth--;
                if (depth === 0) break;
            }
        }

        if (depth === 0) {
            let arg = res.substring(argStart + 1, j);
            let replacement = `diff(${arg}, ${wrt}, ${order})`;
            res = res.substring(0, startIdx) + replacement + res.substring(j + 1);
        } else {
            break;
        }
    }

    const firstOrderRegex = /\bd\/d([a-zA-Z])\s*\(/i;
    while ((match = res.match(firstOrderRegex))) {
        let wrt = match[1];
        let startIdx = match.index;
        let matchLen = match[0].length;
        let argStart = startIdx + matchLen - 1;

        let depth = 1;
        let j = argStart + 1;
        for (; j < res.length; j++) {
            if (res[j] === '(') depth++;
            else if (res[j] === ')') {
                depth--;
                if (depth === 0) break;
            }
        }

        if (depth === 0) {
            let arg = res.substring(argStart + 1, j);
            let replacement = `diff(${arg}, ${wrt}, 1)`;
            res = res.substring(0, startIdx) + replacement + res.substring(j + 1);
        } else {
            break;
        }
    }

    // Support d^n(expr)/d<var>^n
    let idx = res.search(/\bd\^([0-9]+)\(/i);
    while (idx !== -1) {
        let match = res.substring(idx).match(/^d\^([0-9]+)\(/i);
        if (!match) break;
        let order = match[1];
        let argStart = idx + 3 + order.length;
        let depth = 1;
        let j = argStart;
        while (j < res.length && depth > 0) {
            if (res[j] === '(') depth++;
            else if (res[j] === ')') depth--;
            j++;
        }
        if (depth === 0) {
            let exprInside = res.substring(argStart, j - 1);
            let rest = res.substring(j);
            let wrtRegex = new RegExp(`^\\/d([a-zA-Z])\\^${order}\\b`, 'i');
            let wrtMatch = rest.match(wrtRegex);
            if (wrtMatch) {
                let wrt = wrtMatch[1];
                let replacement = `diff(${exprInside}, ${wrt}, ${order})`;
                res = res.substring(0, idx) + replacement + res.substring(j + wrtMatch[0].length);
                idx = res.search(/\bd\^([0-9]+)\(/i);
                continue;
            }
        }
        idx = res.indexOf('d^', idx + 2);
    }

    // Support d(expr)/d<var>
    idx = res.search(/\bd\(/i);
    while (idx !== -1) {
        let argStart = idx + 2;
        let depth = 1;
        let j = argStart;
        while (j < res.length && depth > 0) {
            if (res[j] === '(') depth++;
            else if (res[j] === ')') depth--;
            j++;
        }
        if (depth === 0) {
            let exprInside = res.substring(argStart, j - 1);
            let rest = res.substring(j);
            let wrtMatch = rest.match(/^\/d([a-zA-Z])\b/i);
            if (wrtMatch) {
                let wrt = wrtMatch[1];
                let replacement = `diff(${exprInside}, ${wrt}, 1)`;
                res = res.substring(0, idx) + replacement + res.substring(j + wrtMatch[0].length);
                idx = res.search(/\bd\(/i);
                continue;
            }
        }
        idx = res.indexOf('d(', idx + 2);
    }

    return res;
}

function preprocessCustomRoots(str) {
    if (!str || typeof str !== 'string') return str;

    const rootMap = {
        'second': 2, 'square': 2, 'secnd': 2,
        'third': 3, 'cube': 3,
        'fourth': 4, 'forth': 4,
        'fifth': 5,
        'sixth': 6,
        'seventh': 7,
        'eighth': 8,
        'ninth': 9,
        'tenth': 10
    };

    const words = Object.keys(rootMap).join('|');
    const regex = new RegExp(`(${words})root`, 'i');

    let res = str;
    let match;
    while ((match = res.match(regex))) {
        let word = match[1].toLowerCase();
        let order = rootMap[word];
        let startIdx = match.index;
        let matchLen = match[0].length;
        let argStart = startIdx + matchLen;

        let arg = "";
        let endIdx = argStart;

        if (argStart < res.length && res[argStart] === '(') {
            let depth = 1;
            let j = argStart + 1;
            for (; j < res.length; j++) {
                if (res[j] === '(') depth++;
                else if (res[j] === ')') {
                    depth--;
                    if (depth === 0) break;
                }
            }
            if (depth === 0) {
                arg = res.substring(argStart + 1, j);
                endIdx = j + 1;
            } else {
                arg = res.substring(argStart + 1);
                endIdx = res.length;
            }
        } else {
            let j = argStart;
            if (j < res.length && /\d/.test(res[j])) {
                while (j < res.length && /[\d\.]/.test(res[j])) {
                    j++;
                }
            } else if (j < res.length && /[a-zA-Z]/.test(res[j])) {
                j++;
            }
            arg = res.substring(argStart, j);
            endIdx = j;
        }

        if (!arg) {
            arg = 'x';
        }

        let replacement = `nrt(${arg}, ${order})`;
        res = res.substring(0, startIdx) + replacement + res.substring(endIdx);
    }
    return res;
}

function replaceNrtWithExponent(str) {
    if (!str || typeof str !== 'string') return str;

    let res = str;
    let idx = res.indexOf('nrt(');
    while (idx !== -1) {
        let parenCount = 1;
        let commaIdx = -1;
        let bracketCount = 0;
        let j = idx + 4;
        for (; j < res.length; j++) {
            let c = res[j];
            if (c === '(') parenCount++;
            else if (c === ')') {
                parenCount--;
                if (parenCount === 0) break;
            } else if (c === '[') {
                bracketCount++;
            } else if (c === ']') {
                bracketCount--;
            } else if (c === ',' && parenCount === 1 && bracketCount === 0) {
                commaIdx = j;
            }
        }

        if (parenCount === 0 && commaIdx !== -1) {
            let expr = res.substring(idx + 4, commaIdx).trim();
            let order = res.substring(commaIdx + 1, j).trim();
            let replacement = `((${expr})^(1/(${order})))`;
            res = res.substring(0, idx) + replacement + res.substring(j + 1);
            idx = res.indexOf('nrt(');
        } else {
            idx = res.indexOf('nrt(', idx + 4);
        }
    }
    return res;
}

function getDecimalValue(exprStr) {
    if (!exprStr || typeof exprStr !== 'string') return null;
    try {
        let valText = nerdamer(exprStr).evaluate().text('decimals');
        let numVal = Number(valText.trim());
        if (!isNaN(numVal) && isFinite(numVal)) {
            let floatVal = parseFloat(valText);
            let formatted = floatVal.toFixed(10);
            if (formatted.includes('.')) {
                formatted = formatted.replace(/0+$/, '');
                formatted = formatted.replace(/\.$/, '');
            }
            return formatted;
        }
    } catch (e) {
        console.error("Error in getDecimalValue for expression:", exprStr, e);
    }
    return null;
}


function formatRawMathToLaTeX(str) {
    if (!str) return "";

    let res = str;

    // ── Early word substitutions (bare keywords, no parentheses needed) ──
    // ilaplace must come before laplace (it contains "laplace" as substring)
    res = res.replace(/\bilaplace\b(?!\s*\()/g, '\\mathcal{L}^{-1}');
    res = res.replace(/\blaplace\b(?!\s*\()/g, '\\mathcal{L}');

    function parseArgs(s, startIdx) {
        let openParen = s.indexOf('(', startIdx);
        if (openParen === -1) return null;
        let args = [];
        let currentArg = "";
        let parenCount = 0;
        let bracketCount = 0;
        let i = openParen + 1;
        for (; i < s.length; i++) {
            let c = s[i];
            if (c === '(') parenCount++;
            else if (c === ')') {
                if (parenCount === 0) {
                    args.push(currentArg.trim());
                    return { args: args, endIdx: i };
                }
                parenCount--;
            } else if (c === '[') {
                bracketCount++;
            } else if (c === ']') {
                bracketCount--;
            } else if (c === ',' && parenCount === 0 && bracketCount === 0) {
                args.push(currentArg.trim());
                currentArg = "";
                continue;
            }
            currentArg += c;
        }
        return null;
    }

    const funcNames = [
        "integrate", "ilaplace", "laplace", "product", "acosec", "cosech", "defint", "acsch", "asech",
        "acoth", "cosec", "limit", "sinh", "cosh", "tanh", "sech", "csch",
        "coth", "asin", "acos", "atan", "asec", "acsc", "acot", "fact",
        "pdiff", "diff", "sqrt", "sin", "cos", "tan", "sec", "csc", "cot", "log",
        "abs", "nrt", "sum", "exp", "ln",
        "transpose", "invert", "inverse", "determinant", "det", "matrix", "vector", "multiply",
        "eigenvalues", "eigenvectors", "rref", "basis"
    ];

    let changed = true;
    while (changed) {
        changed = false;
        for (let fn of funcNames) {
            let idx = res.indexOf(fn + '(');
            if (idx !== -1) {
                let parsed = parseArgs(res, idx);
                if (parsed) {
                    let formatted = "";
                    let args = parsed.args;
                    if (fn === "diff" || fn === "pdiff") {
                        let expr = formatRawMathToLaTeX(args[0] || "");
                        let wrt = args[1] || "x";
                        let order = args[2] || "";
                        let dChar = fn === "pdiff" ? "\\partial " : "d";
                        if (order) {
                            formatted = `\\frac{${dChar}^{${order}}}{${dChar}${wrt}^{${order}}}\\left(${expr}\\right)`;
                        } else {
                            formatted = `\\frac{${dChar}}{${dChar}${wrt}}\\left(${expr}\\right)`;
                        }
                    } else if (fn === "laplace") {
                        let expr = formatRawMathToLaTeX(args[0] || "");
                        let wrt = args[1] || "t";
                        let s = args[2] || "s";
                        formatted = `\\mathcal{L}\\left\\{${expr}\\right\\}(${s})`;
                    } else if (fn === "ilaplace") {
                        let expr = formatRawMathToLaTeX(args[0] || "");
                        let wrt = args[1] || "s";
                        let t = args[2] || "t";
                        formatted = `\\mathcal{L}^{-1}\\left\\{${expr}\\right\\}(${t})`;
                    } else if (fn === "integrate") {
                        let expr = formatRawMathToLaTeX(args[0] || "");
                        let wrt = args[1] || "x";
                        formatted = `\\int ${expr} \\, d${wrt}`;
                    } else if (fn === "defint") {
                        let expr = formatRawMathToLaTeX(args[0] || "");
                        let start = args[1] || "a";
                        let end = args[2] || "b";
                        let wrt = args[3] || "x";
                        formatted = `\\int_{${start}}^{${end}} ${expr} \\, d${wrt}`;
                    } else if (fn === "limit") {
                        let expr = formatRawMathToLaTeX(args[0] || "");
                        let wrt = args[1] || "x";
                        let val = args[2] || "0";
                        formatted = `\\lim_{${wrt} \\to ${val}} \\left(${expr}\\right)`;
                    } else if (fn === "sum") {
                        let expr = formatRawMathToLaTeX(args[0] || "");
                        let wrt = args[1] || "x";
                        let start = args[2] || "1";
                        let end = args[3] || "\\infty";
                        formatted = `\\sum_{${wrt}=${start}}^{${end}} ${expr}`;
                    } else if (fn === "product") {
                        let expr = formatRawMathToLaTeX(args[0] || "");
                        let wrt = args[1] || "x";
                        let start = args[2] || "1";
                        let end = args[3] || "\\infty";
                        formatted = `\\prod_{${wrt}=${start}}^{${end}} ${expr}`;
                    } else if (fn === "sqrt") {
                        let expr = formatRawMathToLaTeX(args[0] || "");
                        formatted = `\\sqrt{${expr}}`;
                    } else if (fn === "nrt") {
                        let expr = formatRawMathToLaTeX(args[0] || "");
                        let n = args[1] || "n";
                        formatted = `\\sqrt[${n}]{${expr}}`;
                    } else if (fn === "abs") {
                        let expr = formatRawMathToLaTeX(args[0] || "");
                        formatted = `\\left|${expr}\\right|`;
                    } else if (fn === "fact") {
                        let expr = formatRawMathToLaTeX(args[0] || "");
                        formatted = `\\left(${expr}\\right)!`;
                    } else if (fn === "log") {
                        let expr = formatRawMathToLaTeX(args[0] || "");
                        let base = args[1] || "";
                        if (base) {
                            formatted = `\\log_{${base}}\\left(${expr}\\right)`;
                        } else {
                            formatted = `\\log\\left(${expr}\\right)`;
                        }
                    } else if (fn === "ln") {
                        let expr = formatRawMathToLaTeX(args[0] || "");
                        formatted = `\\ln\\left(${expr}\\right)`;
                    } else if (fn === "matrix") {
                        let latexRows = args.map(r => {
                            let inner = r.trim();
                            if (inner.startsWith('[') && inner.endsWith(']')) {
                                inner = inner.slice(1, -1).trim();
                            }
                            return inner.split(',').map(x => formatRawMathToLaTeX(x.trim())).join(' & ');
                        });
                        formatted = `\\begin{bmatrix}${latexRows.join(' \\\\ ')}\\end{bmatrix}`;
                    } else if (fn === "vector") {
                        let latexCols = args.map(x => formatRawMathToLaTeX(x.trim()));
                        formatted = `\\begin{bmatrix}${latexCols.join(' & ')}\\end{bmatrix}`;
                    } else if (fn === "transpose") {
                        let expr = formatRawMathToLaTeX(args[0] || "");
                        formatted = `{${expr}}^T`;
                    } else if (fn === "invert" || fn === "inverse") {
                        let expr = formatRawMathToLaTeX(args[0] || "");
                        formatted = `{${expr}}^{-1}`;
                    } else if (fn === "determinant" || fn === "det") {
                        let expr = formatRawMathToLaTeX(args[0] || "");
                        if (expr.includes('bmatrix')) {
                            formatted = expr.replace(/bmatrix/g, 'vmatrix');
                        } else {
                            formatted = `\\left|${expr}\\right|`;
                        }
                    } else if (fn === "multiply") {
                        let exprA = formatRawMathToLaTeX(args[0] || "");
                        let exprB = formatRawMathToLaTeX(args[1] || "");
                        formatted = `${exprA} \\cdot ${exprB}`;
                    } else if (["eigenvalues", "eigenvectors", "rref", "basis"].includes(fn)) {
                        let expr = formatRawMathToLaTeX(args[0] || "");
                        formatted = `\\text{${fn}}\\left(${expr}\\right)`;
                    } else if (["sin", "cos", "tan", "sec", "csc", "cosec", "cot",
                        "sinh", "cosh", "tanh", "sech", "csch", "cosech", "coth",
                        "asin", "acos", "atan", "asec", "acsc", "acosec", "acot", "exp"].includes(fn)) {
                        let expr = formatRawMathToLaTeX(args[0] || "");
                        if (fn === 'asin') formatted = `\\sin^{-1}\\left(${expr}\\right)`;
                        else if (fn === 'acos') formatted = `\\cos^{-1}\\left(${expr}\\right)`;
                        else if (fn === 'atan') formatted = `\\tan^{-1}\\left(${expr}\\right)`;
                        else if (fn === 'asec') formatted = `\\sec^{-1}\\left(${expr}\\right)`;
                        else if (fn === 'acsc' || fn === 'acosec') formatted = `\\csc^{-1}\\left(${expr}\\right)`;
                        else if (fn === 'acot') formatted = `\\cot^{-1}\\left(${expr}\\right)`;
                        else if (fn === 'exp') formatted = `\\exp\\left(${expr}\\right)`;
                        else {
                            let latexFn = fn;
                            if (fn === 'cosec') latexFn = 'csc';
                            if (fn === 'cosech') latexFn = 'csch';
                            formatted = `\\${latexFn}\\left(${expr}\\right)`;
                        }
                    }

                    res = res.substring(0, idx) + formatted + res.substring(parsed.endIdx + 1);
                    changed = true;
                    break;
                }
            }
        }
    }

    // Convert parenthesized exponents ^(...) to LaTeX style ^{...}
    let caretIdx = res.indexOf('^(');
    while (caretIdx !== -1) {
        let depth = 1;
        let j = caretIdx + 2;
        for (; j < res.length; j++) {
            if (res[j] === '(') depth++;
            else if (res[j] === ')') {
                depth--;
                if (depth === 0) break;
            }
        }
        if (depth === 0) {
            let inside = res.substring(caretIdx + 2, j);
            res = res.substring(0, caretIdx) + '^{' + inside + '}' + res.substring(j + 1);
            caretIdx = res.indexOf('^(');
        } else {
            caretIdx = res.indexOf('^(', caretIdx + 1);
        }
    }

    // Convert parenthesized subscripts _(...) to LaTeX style _{...}
    let subIdx = res.indexOf('_(');
    while (subIdx !== -1) {
        let depth = 1;
        let j = subIdx + 2;
        for (; j < res.length; j++) {
            if (res[j] === '(') depth++;
            else if (res[j] === ')') {
                depth--;
                if (depth === 0) break;
            }
        }
        if (depth === 0) {
            let inside = res.substring(subIdx + 2, j);
            res = res.substring(0, subIdx) + '_{' + inside + '}' + res.substring(j + 1);
            subIdx = res.indexOf('_(');
        } else {
            subIdx = res.indexOf('_(', subIdx + 1);
        }
    }

    if (!res.includes('\\') && !res.includes('{') && !res.includes('}')) {
        try {
            res = nerdamer.convertToLaTeX(res);
        } catch (e) {
            // Keep as is
        }
    }

    return res;
}
if (typeof window !== 'undefined') {
    window.formatRawMathToLaTeX = formatRawMathToLaTeX;
    window.translateLatexToNerdamer = translateLatexToNerdamer;
    window.katexFormat = katexFormat;
}
if (typeof global !== 'undefined') {
    global.formatRawMathToLaTeX = formatRawMathToLaTeX;
    global.translateLatexToNerdamer = translateLatexToNerdamer;
    global.katexFormat = katexFormat;
}

function setMode(mode) {
    const odeBtn = document.getElementById('mode-ode');
    const mathBtn = document.getElementById('mode-math');
    if (!odeBtn || !mathBtn) return;

    const ode = document.getElementById("ode");
    const math = document.getElementById("math");
    const overlay = document.getElementById("ode-math-overlay");
    const isMobile = window.innerWidth <= 600;

    if (mode === 'ode') {
        odeBtn.classList.add('active');
        mathBtn.classList.remove('active');

        // Show ODE, hide MATH
        if (ode) {
            ode.style.display = 'block';
            if (math) {
                syncSelectionToOde();
            }
            ode.dispatchEvent(new Event('input'));
            ode.focus();
        }
        if (math) {
            math.style.display = 'none';
            math.classList.remove('ode-transparent-text');
        }
        if (overlay) overlay.style.display = 'none';
    } else {
        mathBtn.classList.add('active');
        odeBtn.classList.remove('active');

        // Show MATH, hide ODE
        if (ode) ode.style.display = 'none';
        if (math) {
            math.style.display = 'block';
            math.classList.add('ode-transparent-text');
            if (ode) {
                // copy styles
                if (!isMobile) {
                    math.style.width = ode.style.width;
                    math.style.height = ode.style.height;
                } else {
                    math.style.width = '';
                    math.style.height = '';
                }
                math.style.fontSize = window.getComputedStyle(ode).fontSize;
                math.style.fontFamily = window.getComputedStyle(ode).fontFamily;
                math.style.lineHeight = window.getComputedStyle(ode).lineHeight;
                math.style.padding = window.getComputedStyle(ode).padding;
                // Sync content
                math.value = mapOdeToLatex(ode.value);
            }
            if (overlay) {
                overlay.style.display = 'flex';
                if (ode) {
                    if (!isMobile) {
                        overlay.style.width = `calc(${ode.style.width || '100%'} - 4px)`;
                        overlay.style.height = `calc(${ode.style.height || '60px'} - 4px)`;
                    } else {
                        overlay.style.width = '';
                        overlay.style.height = '';
                    }
                }
            }
            lastMathValue = math.value;
            lastOdeValue = ode ? ode.value : "";
            updateMathOverlay();
            math.focus();
            syncSelectionToMath();
        }
    }
}

// Symbol mode buttons (Complex, Vector, Matrix)
// — exclusive active state within the more-panel group
const MORE_SYMBOL_IDS = ['sym-complex', 'sym-vector', 'sym-matrix'];

function showSubPanel(type) {
    const subpanels = {
        'complex': 'panel-complex',
        'vector': 'panel-vector',
        'matrix': 'panel-matrix'
    };

    // Hide all sub-panels first
    Object.values(subpanels).forEach(id => {
        const p = document.getElementById(id);
        if (p) p.style.display = 'none';
    });

    // Show active one
    const activeId = subpanels[type];
    const activePanel = activeId ? document.getElementById(activeId) : null;
    if (activePanel) {
        activePanel.style.display = 'flex';
    }
}

function setSymbolMode(type, skipInsert = false) {
    const typeToId = {
        'complex': 'sym-complex',
        'vector': 'sym-vector',
        'matrix': 'sym-matrix'
    };
    const activeId = typeToId[type];
    const clickedBtn = activeId ? document.getElementById(activeId) : null;
    const alreadyActive = clickedBtn && clickedBtn.classList.contains('active');

    // Always clear all first
    MORE_SYMBOL_IDS.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.classList.remove('active');
    });

    if (alreadyActive) {
        // Clicked again — deactivate
        showSubPanel(null);
        return;
    }

    // First click — activate
    if (clickedBtn) clickedBtn.classList.add('active');
    showSubPanel(type);
}

function insertSymbolOp(op) {
    const math = document.getElementById("math");
    if (!math) return;

    let start = math.selectionStart;
    let end = math.selectionEnd;
    let val = math.value;
    let selected = val.substring(start, end);

    let insertText = "";
    let newCursor = start;
    let rows = 2, cols = 2;
    let sizeCancelled = false;

    const isMobile = window.innerWidth <= 600;

    if (isMobile && (op === 'matrix_template' || op === 'identity' || op === 'null')) {
        let defaultPromptVal = "2x2";
        let promptMsg = "Enter matrix size (e.g. 3x3 or 3):";
        if (op === 'identity') {
            defaultPromptVal = "2";
            promptMsg = "Enter identity matrix size (e.g. 3):";
        }
        let size = prompt(promptMsg, defaultPromptVal);
        if (size === null) {
            sizeCancelled = true;
        } else {
            let cleanSize = size.trim().toLowerCase().replace(/\\times/g, '*');
            let valid = false;
            if (/^\d+$/.test(cleanSize)) {
                rows = parseInt(cleanSize);
                cols = rows;
                valid = true;
            } else {
                let parts = cleanSize.split(/[\*x,]/);
                if (parts.length === 2 && /^\d+$/.test(parts[0].trim()) && /^\d+$/.test(parts[1].trim())) {
                    rows = parseInt(parts[0].trim());
                    cols = parseInt(parts[1].trim());
                    valid = true;
                }
            }
            if (!valid || rows <= 0 || cols <= 0) {
                rows = 2;
                cols = 2;
            }
        }
    }

    if (sizeCancelled) return;

    switch (op) {
        case 'conjugate':
            insertText = selected ? `\\text{conjugate}(${selected})` : `\\text{conjugate}({})`;
            newCursor = selected ? start + insertText.length : start + 16;
            break;
        case 'abs':
            insertText = selected ? `\\lvert ${selected} \\rvert` : `\\lvert {} \\rvert`;
            newCursor = selected ? start + insertText.length : start + 8;
            break;
        case 'arg':
            insertText = selected ? `\\text{arg}(${selected})` : `\\text{arg}({})`;
            newCursor = selected ? start + insertText.length : start + 10;
            break;
        case 'realpart':
            insertText = selected ? `\\text{realpart}(${selected})` : `\\text{realpart}({})`;
            newCursor = selected ? start + insertText.length : start + 15;
            break;
        case 'imagpart':
            insertText = selected ? `\\text{imagpart}(${selected})` : `\\text{imagpart}({})`;
            newCursor = selected ? start + insertText.length : start + 15;
            break;
        case 'polarform':
            insertText = selected ? `\\text{polarform}(${selected})` : `\\text{polarform}({})`;
            newCursor = selected ? start + insertText.length : start + 16;
            break;
        case 'rectform':
            insertText = selected ? `\\text{rectform}(${selected})` : `\\text{rectform}({})`;
            newCursor = selected ? start + insertText.length : start + 15;
            break;

        case 'vector':
            insertText = `\\begin{bmatrix}_ & _ & _\\end{bmatrix}`;
            newCursor = start + 16;
            break;
        case 'dot':
            insertText = `\\text{dot}({}, {})`;
            newCursor = start + 10;
            break;
        case 'cross':
            insertText = `\\text{cross}({}, {})`;
            newCursor = start + 12;
            break;
        case 'mag':
            insertText = selected ? `\\lvert ${selected} \\rvert` : `\\lvert [\\ ] \\rvert`;
            newCursor = selected ? start + insertText.length : start + 8;
            break;
        case 'normalize':
            if (selected) {
                let wrapped = (selected.startsWith('\\begin{bmatrix}') || selected.startsWith('[')) ? selected : `[${selected}]`;
                insertText = `\\frac{${wrapped}}{\\lvert ${wrapped} \\rvert}`;
                newCursor = start + insertText.length;
            } else {
                insertText = `\\frac{[\\ ]}{\\lvert[\\ ]\\rvert}`;
                let firstBracket = insertText.indexOf('[\\ ]');
                newCursor = start + firstBracket + 1;
            }
            break;
        case 'angle':
            insertText = `\\cos^{-1}\\left(\\frac{[\\ ] \\cdot [\\ ]}{\\lvert[\\ ]\\rvert \\lvert[\\ ]\\rvert}\\right)`;
            {
                let firstBracket = insertText.indexOf('[\\ ]');
                newCursor = start + firstBracket + 1;
            }
            break;

        case 'matrix_template':
            if (isMobile) {
                let rowsArr = [];
                for (let r = 0; r < rows; r++) {
                    let colArr = Array(cols).fill('_');
                    rowsArr.push(colArr.join(' & '));
                }
                insertText = `\\begin{bmatrix}${rowsArr.join(' \\\\ ')}\\end{bmatrix}`;
            } else {
                insertText = `\\begin{bmatrix}\\end{bmatrix}_{_ \\times _}`;
                {
                    let subStart = insertText.indexOf('_{');
                    let underIdx = insertText.indexOf('_', subStart + 2);
                    newCursor = start + underIdx;
                }
            }
            break;
        case 'transpose':
            if (selected) {
                insertText = `${selected}^T`;
                newCursor = start + insertText.length;
            } else {
                insertText = `^T`;
                newCursor = start + 2;
            }
            break;
        case 'det':
            if (selected) {
                if (selected.includes('bmatrix')) {
                    insertText = selected.replace(/bmatrix/g, 'vmatrix');
                } else if (selected.includes('matrix')) {
                    insertText = selected.replace(/matrix/g, 'vmatrix');
                } else {
                    insertText = `\\text{determinant}(${selected})`;
                }
                newCursor = start + insertText.length;
            } else {
                insertText = `\\begin{vmatrix}\\end{vmatrix}_{_ \\times _}`;
                let subStart = insertText.indexOf('_{');
                let underIdx = insertText.indexOf('_', subStart + 2);
                newCursor = start + underIdx;
            }
            break;
        case 'inverse':
            if (selected) {
                insertText = `${selected}^{-1}`;
                newCursor = start + insertText.length;
            } else {
                insertText = `^{-1}`;
                newCursor = start + 5;
            }
            break;
        case 'identity':
            if (isMobile) {
                let rowsArr = [];
                for (let r = 0; r < rows; r++) {
                    let colArr = Array(cols).fill('0');
                    if (r < cols) colArr[r] = '1';
                    rowsArr.push(colArr.join(' & '));
                }
                insertText = `\\begin{bmatrix}${rowsArr.join(' \\\\ ')}\\end{bmatrix}`;
            } else {
                insertText = `\\begin{bmatrix}I\\end{bmatrix}_{_ \\times _}`;
                {
                    let subStart = insertText.indexOf('_{');
                    let underIdx = insertText.indexOf('_', subStart + 2);
                    newCursor = start + underIdx;
                }
            }
            break;
        case 'null':
            if (isMobile) {
                let rowsArr = [];
                for (let r = 0; r < rows; r++) {
                    let colArr = Array(cols).fill('0');
                    rowsArr.push(colArr.join(' & '));
                }
                insertText = `\\begin{bmatrix}${rowsArr.join(' \\\\ ')}\\end{bmatrix}`;
            } else {
                insertText = `\\begin{bmatrix}O\\end{bmatrix}_{_ \\times _}`;
                {
                    let subStart = insertText.indexOf('_{');
                    let underIdx = insertText.indexOf('_', subStart + 2);
                    newCursor = start + underIdx;
                }
            }
            break;
        case 'eigenvalues':
            insertText = selected ? `\\text{eigenvalues}(${selected})` : `\\text{eigenvalues}({})`;
            newCursor = selected ? start + insertText.length : start + 18;
            break;
        case 'eigenvectors':
            insertText = selected ? `\\text{eigenvectors}(${selected})` : `\\text{eigenvectors}({})`;
            newCursor = selected ? start + insertText.length : start + 19;
            break;
        case 'rref':
            insertText = selected ? `\\text{rref}(${selected})` : `\\text{rref}({})`;
            newCursor = selected ? start + insertText.length : start + 11;
            break;
        case 'basis':
            insertText = selected ? `\\text{basis}(${selected})` : `\\text{basis}({})`;
            newCursor = selected ? start + insertText.length : start + 12;
            break;
    }

    isProgrammaticUpdate = true;
    math.value = val.substring(0, start) + insertText + val.substring(end);

    math.focus();
    if (op === 'matrix_template' || op === 'identity' || op === 'null') {
        if (isMobile) {
            let firstUnder = insertText.indexOf('_');
            if (firstUnder !== -1) {
                newCursor = start + firstUnder;
                math.setSelectionRange(newCursor, newCursor + 1);
            } else {
                newCursor = start + insertText.length;
                math.setSelectionRange(newCursor, newCursor);
            }
        } else {
            math.setSelectionRange(newCursor, newCursor + 1);
        }
    } else if (op === 'normalize' || op === 'angle') {
        let firstBracket = math.value.indexOf('[]', start);
        if (firstBracket !== -1) {
            math.setSelectionRange(firstBracket + 1, firstBracket + 1);
        } else {
            math.setSelectionRange(newCursor, newCursor);
        }
    } else if (insertText.includes('_')) {
        let firstUnder = findNextPlaceholder(math.value, start);
        if (firstUnder !== -1) {
            math.setSelectionRange(firstUnder, firstUnder + 1);
        } else {
            math.setSelectionRange(newCursor, newCursor);
        }
    } else {
        math.setSelectionRange(newCursor, newCursor);
    }

    math.dispatchEvent(new Event('input'));
    isProgrammaticUpdate = false;
}

if (typeof window !== 'undefined') {
    window.setMode = setMode;
    window.setSymbolMode = setSymbolMode;
    window.insertSymbolOp = insertSymbolOp;
}

function saveSolutionToHistory(rawInput, formattedSolution) {
    if (typeof localStorage === 'undefined') return;
    try {
        let history = JSON.parse(localStorage.getItem('mathgabs_history') || '[]');
        if (history.length > 0 && history[history.length - 1].input === rawInput) {
            return;
        }
        history.push({
            input: rawInput,
            solution: formattedSolution,
            timestamp: new Date().getTime()
        });
        localStorage.setItem('mathgabs_history', JSON.stringify(history));
        renderSavedSolutions();
    } catch (e) {
        console.error("Error saving to history:", e);
    }
}

function renderSavedSolutions() {
    if (typeof document === 'undefined') return;
    const listEl = document.getElementById('savedSolutionsList');
    if (!listEl) return;
    listEl.innerHTML = '';

    const history = JSON.parse(localStorage.getItem('mathgabs_history') || '[]');
    if (history.length === 0) {
        listEl.innerHTML = '<p style="color: #888; font-style: italic; font-size: 0.85rem; text-align: center; margin-top: 20px;">No saved solutions yet.</p>';
        return;
    }

    history.forEach((item, index) => {
        const itemEl = document.createElement('div');
        itemEl.className = 'saved-item';
        itemEl.style.padding = '12px 0';
        itemEl.style.borderBottom = '1px solid #eee';
        itemEl.style.fontFamily = 'Inter, sans-serif';
        itemEl.style.fontSize = '0.85rem';
        itemEl.style.position = 'relative';

        const numEl = document.createElement('span');
        numEl.style.fontWeight = 'bold';
        numEl.style.color = '#00a994';
        numEl.style.marginRight = '8px';
        numEl.textContent = `${index + 1}.`;

        const contentEl = document.createElement('div');
        contentEl.style.display = 'inline-block';
        contentEl.style.width = 'calc(100% - 24px)';
        contentEl.style.verticalAlign = 'top';

        const inputLabel = document.createElement('div');
        inputLabel.className = 'saved-label saved-label--input';
        inputLabel.style.marginBottom = '4px';

        let inputLatex = item.input;
        try {
            if (!inputLatex.includes('\\')) {
                inputLatex = formatRawMathToLaTeX(inputLatex);
            }
        } catch (e) { }

        inputLabel.innerHTML = `<span class="saved-label-text saved-label-text--input">Input:</span> <span class="saved-input-math"></span>`;
        contentEl.appendChild(inputLabel);

        const solLabel = document.createElement('div');
        solLabel.className = 'saved-label saved-label--solution';
        solLabel.innerHTML = `<span class="saved-label-text saved-label-text--solution">Solution:</span> <span class="saved-sol-math"></span>`;
        contentEl.appendChild(solLabel);

        itemEl.appendChild(numEl);
        itemEl.appendChild(contentEl);
        listEl.appendChild(itemEl);

        const inputSpan = inputLabel.querySelector('.saved-input-math');
        const solSpan = solLabel.querySelector('.saved-sol-math');

        try {
            renderKatex(inputLatex, inputSpan, { throwOnError: false });
        } catch (e) {
            inputSpan.textContent = item.input;
        }

        try {
            renderKatex(item.solution, solSpan, { throwOnError: false });
        } catch (e) {
            solSpan.textContent = item.solution;
        }
    });
}

function clearHistory() {
    if (typeof localStorage === 'undefined') return;
    if (confirm("Are you sure you want to clear your saved solutions history?")) {
        localStorage.removeItem('mathgabs_history');
        renderSavedSolutions();
    }
}

if (typeof window !== 'undefined') {
    window.toggleSavedPanel = toggleSavedPanel;
    window.clearHistory = clearHistory;
    window.renderSavedSolutions = renderSavedSolutions;
}

function simplifyFractionsInText(str) {
    if (!str || typeof str !== 'string') return str;

    // 1. Simplify decimals to fractions
    // Match numbers like 0.333333333333 or 1.5 etc.
    str = str.replace(/\b\d+\.\d+\b/g, (match) => {
        let val = parseFloat(match);
        let simple = toSimpleFraction(val);
        return simple;
    });

    // 2. Simplify large fractions
    // Match fractions like 12345/67890 or 4/8 etc.
    str = str.replace(/\b(\d+)\/(\d+)\b/g, (match, numStr, denStr) => {
        let num = parseInt(numStr);
        let den = parseInt(denStr);
        let val = num / den;
        let simple = toSimpleFraction(val);
        // Only replace if the new denominator is smaller or if it evaluates to an integer
        if (simple.includes('/')) {
            let parts = simple.split('/');
            let newDen = parseInt(parts[1]);
            if (newDen < den) {
                return simple;
            }
        } else {
            // It simplified to an integer or decimal!
            return simple;
        }
        return match;
    });

    // 3. Simplify LaTeX fractions like \frac{12345}{67890}
    str = str.replace(/\\frac\{\s*(-?\d+)\s*\}\{\s*(-?\d+)\s*\}/g, (match, numStr, denStr) => {
        let num = parseInt(numStr);
        let den = parseInt(denStr);
        let val = num / den;
        let simple = toSimpleFraction(val);
        if (simple.includes('/')) {
            let parts = simple.split('/');
            let newNum = parseInt(parts[0]);
            let newDen = parseInt(parts[1]);
            if (Math.abs(newDen) < Math.abs(den)) {
                return `\\frac{${newNum}}{${newDen}}`;
            }
        } else {
            // It simplified to an integer or decimal!
            return simple;
        }
        return match;
    });

    return str;
}

function replaceDiffsWithProductRule(unsolved) {
    let idx = unsolved.indexOf('diff(');
    while (idx !== -1) {
        if (idx > 0 && unsolved[idx - 1] === 'p') {
            idx = unsolved.indexOf('diff(', idx + 1);
            continue;
        }
        let bracketCount = 1;
        let j = idx + 5;
        while (j < unsolved.length && bracketCount > 0) {
            if (unsolved[j] === '(') {
                bracketCount++;
            } else if (unsolved[j] === ')') {
                bracketCount--;
            }
            j++;
        }
        if (bracketCount === 0) {
            let fullDiff = unsolved.slice(idx, j);
            let argsStr = fullDiff.slice(5, -1);
            let args = [];
            let currentArg = "";
            let depth = 0;
            for (let c = 0; c < argsStr.length; c++) {
                let char = argsStr[c];
                if (char === '(') depth++;
                else if (char === ')') depth--;

                if (char === ',' && depth === 0) {
                    args.push(currentArg.trim());
                    currentArg = "";
                } else {
                    currentArg += char;
                }
            }
            args.push(currentArg.trim());

            if (args.length >= 2 && args[1] === 'x' && args[0].includes('y')) {
                let expr = args[0];
                let order = args.length >= 3 ? args[2] : "1";
                let replacement = productRule(expr, order);
                unsolved = unsolved.replaceAll(fullDiff, `(${replacement})`);
                idx = unsolved.indexOf('diff(');
                continue;
            }
        }
        idx = unsolved.indexOf('diff(', idx + 1);
    }
    return unsolved;
}

function solveSystemOfEquations(equations, eqLaTeXs) {
    const solId = document.getElementById('solution');
    if (!solId) return;
    solId.innerHTML = '';

    try {
        if (!eqLaTeXs) {
            eqLaTeXs = equations.map(eq => {
                let parts = eq.split('=');
                return nerdamer(parts[0].trim()).toTeX() + ' = ' + nerdamer(parts[1].trim()).toTeX();
            });
        }

        // Solve the system using nerdamer.solveEquations
        let solution = nerdamer.solveEquations(equations);

        const pEq = document.createElement('p');
        renderKatex(`\\text{System: } \\begin{cases} ` + eqLaTeXs.join(' \\\\ ') + ` \\end{cases}`, pEq, { throwOnError: false });
        solId.appendChild(pEq);

        const pSol = document.createElement('p');
        if (solution && solution.length > 0) {
            let solLines = [];
            if (Array.isArray(solution[0])) {
                for (let sol of solution) {
                    let varName = sol[0];
                    let val = sol[1].toString();
                    let latexVal = katexFormat(simplifyFractionsInText(val));
                    let dec = getDecimalValue(val);
                    if (dec && dec !== val && dec !== simplifyFractionsInText(val)) {
                        latexVal += " \\approx " + dec;
                    }
                    solLines.push(`${varName} = ${latexVal}`);
                }
            } else {
                let varName = solution[0];
                let val = solution[1];
                if (Array.isArray(val)) {
                    val = val[0];
                }
                let valStr = val.toString();
                let latexVal = katexFormat(simplifyFractionsInText(valStr));
                let dec = getDecimalValue(valStr);
                if (dec && dec !== valStr && dec !== simplifyFractionsInText(valStr)) {
                    latexVal += " \\approx " + dec;
                }
                solLines.push(`${varName} = ${latexVal}`);
            }

            let finalSystemSol = solLines.join(',\\quad ');
            renderKatex(finalSystemSol, pSol, { throwOnError: false });
            solId.appendChild(pSol);
            if (typeof window !== 'undefined') {
                window.mathSolverLastSolution = finalSystemSol;
            }
        } else {
            const pNoSol = document.createElement('p');
            pNoSol.innerText = "No solution found.";
            solId.appendChild(pNoSol);
            if (typeof window !== 'undefined') {
                window.mathSolverLastSolution = "No solution found.";
            }
        }
    } catch (e) {
        console.error("Error solving system of equations:", e);
        const pErr = document.createElement('p');
        pErr.innerText = `Could not solve the system of equations: ${e.message}`;
        solId.appendChild(pErr);
    }
}

function preprocessBracketMatrices(str) {
    if (!str || typeof str !== 'string') return str;
    let res = "";
    let i = 0;
    while (i < str.length) {
        if (str[i] === '[' && str[i + 1] === '[') {
            let depth = 1;
            let j = i + 1;
            while (j < str.length && depth > 0) {
                let c = str[j];
                if (c === '[') depth++;
                else if (c === ']') depth--;
                j++;
            }
            if (depth === 0) {
                let content = str.substring(i + 1, j - 1).trim();
                let rows = [];
                let rowStart = 0;
                let inBracket = 0;
                for (let k = 0; k < content.length; k++) {
                    if (content[k] === '[') inBracket++;
                    else if (content[k] === ']') inBracket--;
                    else if (content[k] === ',' && inBracket === 0) {
                        rows.push(content.substring(rowStart, k).trim());
                        rowStart = k + 1;
                    }
                }
                rows.push(content.substring(rowStart).trim());
                let allRowsValid = rows.every(r => r.startsWith('[') && r.endsWith(']'));
                if (allRowsValid && rows.length > 0) {
                    let matrixStr = `matrix(${rows.join(',')})`;
                    res += matrixStr;
                    i = j;
                    continue;
                }
            }
        }
        res += str[i];
        i++;
    }
    return res;
}

function convertBracketMatrixToLatex(str) {
    if (!str || typeof str !== 'string') return str;
    let res = "";
    let i = 0;
    while (i < str.length) {
        if (str[i] === '[' && str[i + 1] === '[') {
            let depth = 1;
            let j = i + 1;
            while (j < str.length && depth > 0) {
                let c = str[j];
                if (c === '[') depth++;
                else if (c === ']') depth--;
                j++;
            }
            if (depth === 0) {
                let content = str.substring(i + 1, j - 1).trim();
                let rows = [];
                let rowStart = 0;
                let inBracket = 0;
                for (let k = 0; k < content.length; k++) {
                    if (content[k] === '[') inBracket++;
                    else if (content[k] === ']') inBracket--;
                    else if (content[k] === ',' && inBracket === 0) {
                        rows.push(content.substring(rowStart, k).trim());
                        rowStart = k + 1;
                    }
                }
                rows.push(content.substring(rowStart).trim());
                let allRowsValid = rows.every(r => r.startsWith('[') && r.endsWith(']'));
                if (allRowsValid && rows.length > 0) {
                    let latexRows = rows.map(r => {
                        let inner = r.slice(1, -1).trim();
                        return inner.split(',').map(x => x.trim()).join(' & ');
                    });
                    let latexStr = `\\begin{bmatrix}${latexRows.join(' \\\\ ')}\\end{bmatrix}`;
                    res += latexStr;
                    i = j;
                    continue;
                }
            }
        }
        res += str[i];
        i++;
    }
    return res;
}

function mathSolver(user_input, rawDisplayInput = "") {
    if (typeof window !== 'undefined') {
        window.mathSolverLastSolution = "";
    }
    if (typeof document === 'undefined') return;
    const solId = document.getElementById('solution');
    if (!solId) return;
    solId.innerHTML = '';

    let trimmedInput = user_input.trim();
    // Interpret <=, >=, approx= as = for calculations
    trimmedInput = trimmedInput.replace(/<=/g, '=')
        .replace(/>=/g, '=')
        .replace(/approx=/g, '=');
    if (!trimmedInput) {
        const p = document.createElement('p');
        p.innerText = "Please enter an expression.";
        solId.appendChild(p);
        return;
    }

    // Check if it's a system of equations
    let equations = trimmedInput.split(';').map(e => e.trim()).filter(Boolean);
    if (equations.length > 1 && equations.every(eq => eq.includes('='))) {
        let eqLaTeXs;
        let isMathActive = false;
        if (typeof document !== 'undefined') {
            const mathBtn = document.getElementById('mode-math');
            if (mathBtn && mathBtn.classList.contains('active')) {
                isMathActive = true;
            }
        }
        if (isMathActive && rawDisplayInput) {
            eqLaTeXs = rawDisplayInput.split(';').map(eq => eq.trim()).filter(Boolean);
        } else {
            eqLaTeXs = equations.map(eq => formatRawMathToLaTeX(eq));
        }
        solveSystemOfEquations(equations, eqLaTeXs);
        return;
    }

    let isMathActive = false;
    if (typeof document !== 'undefined') {
        const mathBtn = document.getElementById('mode-math');
        if (mathBtn && mathBtn.classList.contains('active')) {
            isMathActive = true;
        }
    }

    // Preprocess bracket matrices and wrap matrix multiplication first
    trimmedInput = preprocessBracketMatrices(trimmedInput);
    trimmedInput = wrapMatrixMultiplication(trimmedInput);

    let processedInput = trimmedInput;
    if (isMathActive) {
        processedInput = translateLatexToNerdamer(processedInput);
    }

    processedInput = convertLeibnizToDiff(processedInput);
    processedInput = preprocessTrigPowers(processedInput);
    processedInput = insertImplicitStars(processedInput);
    processedInput = replaceNrtWithExponent(preprocessCustomRoots(replaceDiffsWithProductRule(processedInput)));
    processedInput = processedInput.replaceAll('pdiff(', 'diff(');

    let displayLaTeX = "";
    if (isMathActive && rawDisplayInput) {
        displayLaTeX = convertBracketMatrixToLatex(rawDisplayInput);
    } else {
        let inputForLatex = rawDisplayInput || user_input;
        inputForLatex = convertBracketMatrixToLatex(inputForLatex);
        displayLaTeX = formatRawMathToLaTeX(preprocessTrigPowers(convertLeibnizToDiff(inputForLatex)));
    }

    try {
        if (processedInput.includes('=')) {
            let parts = processedInput.split('=');
            let lhs = parts[0].trim();
            let rhs = parts[1].trim();

            // Standardize equation to LHS - (RHS) = 0
            let eq = `(${lhs}) - (${rhs})`;

            // Solve equation
            let solutions = nerdamer("solve(" + eq + ", x)");

            // Render original equation
            const pEq = document.createElement('p');
            renderKatex(`\\text{Equation: } ${displayLaTeX}`, pEq, { throwOnError: false });
            solId.appendChild(pEq);

            // Render solutions
            const pSol = document.createElement('p');
            let solList = [];
            if (solutions.symbol && solutions.symbol.elements) {
                solList = solutions.symbol.elements;
            } else if (solutions) {
                solList = Array.isArray(solutions) ? solutions : [solutions];
            }

            let formattedSols = solList.map(el => {
                let str = el.toString();
                let latex = katexFormat(simplifyFractionsInText(str));
                let dec = getDecimalValue(str);
                if (dec && dec !== str && dec !== simplifyFractionsInText(str)) {
                    return latex + " \\approx " + dec;
                }
                return latex;
            });

            let solLaTeX = "";
            if (solList.length === 0) {
                solLaTeX = "[]";
            } else {
                solLaTeX = formattedSols.join(', ');
            }
            renderKatex(`x = ${solLaTeX}`, pSol, { throwOnError: false });
            solId.appendChild(pSol);
            if (typeof window !== 'undefined') {
                window.mathSolverLastSolution = `x = ${solLaTeX}`;
            }
            saveSolutionToHistory(user_input, `x = ${solLaTeX}`);
        } else {
            // Check if it is a custom matrix/vector function to intercept and format beautifully
            let matrixOpMatch = processedInput.match(/^(eigenvalues|eigenvectors|rref|basis|multiply)\(([\s\S]+)\)$/i);
            if (matrixOpMatch) {
                let func = matrixOpMatch[1].toLowerCase();
                // For 'multiply', parse the two matrix args ourselves
                // to avoid nerdamer failing when the return value is a Matrix
                if (func === 'multiply') {
                    try {
                        // Split the two top-level arguments of multiply(A, B)
                        let innerStr = matrixOpMatch[2].trim();
                        // Walk through to find the comma that separates the two top-level args
                        let depth2 = 0, splitIdx = -1;
                        for (let ci = 0; ci < innerStr.length; ci++) {
                            if (innerStr[ci] === '(' || innerStr[ci] === '[') depth2++;
                            else if (innerStr[ci] === ')' || innerStr[ci] === ']') depth2--;
                            else if (innerStr[ci] === ',' && depth2 === 0) { splitIdx = ci; break; }
                        }
                        if (splitIdx === -1) throw new Error('multiply() requires two arguments');
                        let argA = innerStr.slice(0, splitIdx).trim();
                        let argB = innerStr.slice(splitIdx + 1).trim();

                        const core = nerdamer.getCore();
                        let MA_expr = nerdamer(argA);
                        let MB_expr = nerdamer(argB);
                        if (!(MA_expr.symbol instanceof core.Matrix)) throw new Error('First argument of multiply() must be a matrix');
                        if (!(MB_expr.symbol instanceof core.Matrix)) throw new Error('Second argument of multiply() must be a matrix');

                        let MA = MA_expr.symbol, MB = MB_expr.symbol;
                        let rowsA = MA.rows(), colsA = MA.cols();
                        let rowsB = MB.rows(), colsB = MB.cols();
                        if (colsA !== rowsB) throw new Error(`Matrix dimensions incompatible for multiplication: (${rowsA}\u00d7${colsA}) \u00b7 (${rowsB}\u00d7${colsB})`);

                        // Compute result matrix: C[i][j] = sum_k A[i][k] * B[k][j]
                        let result = [];
                        for (let i = 0; i < rowsA; i++) {
                            let row = [];
                            for (let j = 0; j < colsB; j++) {
                                let cell = nerdamer('0').symbol;
                                for (let k = 0; k < colsA; k++) {
                                    let prod = core.PARSER.multiply(MA.get(i, k), MB.get(k, j));
                                    cell = core.PARSER.add(cell, prod);
                                }
                                row.push(cell);
                            }
                            result.push(row);
                        }
                        let resultMatrix = new core.Matrix(...result);
                        let resultLaTeX = formatNerdamerMatrixToBMatrix(resultMatrix);

                        const pIn2 = document.createElement('p');
                        renderKatex(`\\text{Input: } ${displayLaTeX}`, pIn2, { throwOnError: false });
                        solId.appendChild(pIn2);

                        const pOut2 = document.createElement('p');
                        renderKatex(`\\text{Result: } ${resultLaTeX}`, pOut2, { throwOnError: false });
                        solId.appendChild(pOut2);

                        if (typeof window !== 'undefined') window.mathSolverLastSolution = resultLaTeX;
                        saveSolutionToHistory(user_input, resultLaTeX);

                        if (typeof document !== 'undefined') {
                            const mathEl2 = document.getElementById('math');
                            if (mathEl2) {
                                if (typeof window !== 'undefined') window._mathSolveJustRan = true;
                                resizeTextarea(mathEl2);
                                updateMathOverlay();
                            }
                        }
                        return;
                    } catch (err2) {
                        console.error('Error in multiply():', err2);
                        const pErr2 = document.createElement('p');
                        pErr2.innerText = `Error: ${err2.message}`;
                        solId.appendChild(pErr2);
                        return;
                    }
                }

                let func2 = func; // for the block below
                let argStr = matrixOpMatch[2].trim();

                try {
                    let M_expr = nerdamer(argStr);
                    const core = nerdamer.getCore();
                    if (!(M_expr.symbol instanceof core.Matrix)) {
                        throw new Error(`Argument to ${func2}() must evaluate to a matrix.`);
                    }

                    const pIn = document.createElement('p');
                    renderKatex(`\\text{Input: } ${displayLaTeX}`, pIn, { throwOnError: false });
                    solId.appendChild(pIn);

                    const pOut = document.createElement('p');
                    let resultLaTeX = "";

                    if (func === 'eigenvalues') {
                        let evsExpr = calculateEigenvalues(M_expr.symbol);
                        resultLaTeX = `\\lambda = ` + katexFormat(evsExpr.toString());
                    } else if (func === 'eigenvectors') {
                        let evecs = calculateEigenvectors(M_expr.symbol);
                        resultLaTeX = `\\text{Eigenvalues and Eigenvectors: } \\\\ ` + formatEigenvectorsLaTeX(evecs);
                    } else if (func === 'rref') {
                        let arr = parseNerdamerMatrix(M_expr.symbol);
                        let rrefArr = rrefSymbolic(arr);
                        let rrefMatrix = new core.Matrix(...rrefArr.map(row => row.map(x => x.symbol)));
                        resultLaTeX = `\\text{RREF} = ` + formatNerdamerMatrixToBMatrix(rrefMatrix);
                    } else if (func === 'basis') {
                        let arr = parseNerdamerMatrix(M_expr.symbol);
                        let numRows = arr.length;
                        let numCols = arr[0].length;
                        let R = rrefSymbolic(arr);
                        let pivotCols = [];
                        for (let r = 0; r < numRows; r++) {
                            let p = -1;
                            for (let c = 0; c < numCols; c++) {
                                if (nerdamer(R[r][c]).simplify().toString() !== '0') {
                                    p = c;
                                    break;
                                }
                            }
                            if (p !== -1) pivotCols.push(p);
                        }
                        let basisLaTeXs = [];
                        for (let c of pivotCols) {
                            let colVec = [];
                            for (let r = 0; r < numRows; r++) {
                                colVec.push(nerdamer(arr[r][c]).toTeX());
                            }
                            basisLaTeXs.push(`\\begin{bmatrix} ${colVec.join(' \\\\ ')} \\end{bmatrix}`);
                        }
                        resultLaTeX = `\\text{Basis columns: } \\left\\{ ${basisLaTeXs.join(', ')} \\right\\}`;
                    }

                    renderKatex(resultLaTeX, pOut, { throwOnError: false });
                    solId.appendChild(pOut);

                    if (typeof window !== 'undefined') {
                        window.mathSolverLastSolution = resultLaTeX;
                    }
                    saveSolutionToHistory(user_input, resultLaTeX);

                    if (typeof document !== 'undefined') {
                        const mathEl = document.getElementById("math");
                        if (mathEl) {
                            if (typeof window !== 'undefined') window._mathSolveJustRan = true;
                            resizeTextarea(mathEl);
                            updateMathOverlay();
                        }
                    }
                    return;
                } catch (err) {
                    console.error("Error in custom matrix op:", err);
                    const pErr = document.createElement('p');
                    pErr.innerText = `Error: ${err.message}`;
                    solId.appendChild(pErr);
                    return;
                }
            }

            let expr = nerdamer(processedInput);

            const pIn = document.createElement('p');
            renderKatex(`\\text{Input: } ${displayLaTeX}`, pIn, { throwOnError: false });
            solId.appendChild(pIn);

            const pOut = document.createElement('p');
            let resultLaTeX = '';

            // Check if result is a Matrix (e.g. from multiply(), rref(), etc.)
            // Matrix objects don't have .text() or .simplify(), so handle separately.
            const _core = (typeof nerdamer !== 'undefined' && nerdamer.getCore) ? nerdamer.getCore() : null;
            if (_core && expr.symbol instanceof _core.Matrix) {
                resultLaTeX = `\\text{Result: } ` + formatNerdamerMatrixToBMatrix(expr.symbol);
            } else if (_core && expr.symbol instanceof _core.Vector) {
                let cols = expr.symbol.elements.map(x => nerdamer(x).toTeX());
                resultLaTeX = `\\text{Result: } \\begin{bmatrix}` + cols.join(' & ') + `\\end{bmatrix}`;
            } else {
                let evaluated = expr.evaluate();
                let simplified = expr.simplify();
                let simplifiedStr = simplifyFractionsInText(simplified.toString());
                resultLaTeX = katexFormat(simplifiedStr);

                let dec = getDecimalValue(processedInput);
                if (dec && dec !== simplifiedStr && dec !== simplifyFractionsInText(simplified.toString())) {
                    resultLaTeX = resultLaTeX + ' \\approx ' + dec;
                } else if (evaluated.toString() !== simplified.toString()) {
                    try {
                        let evalText = simplifyFractionsInText(evaluated.text());
                        let numVal = Number(evalText.trim());
                        if (!isNaN(numVal) && isFinite(numVal)) {
                            resultLaTeX = katexFormat(simplifiedStr) + ' \\approx ' + evalText;
                        } else {
                            resultLaTeX = katexFormat(simplifiedStr);
                        }
                    } catch (_) {
                        resultLaTeX = katexFormat(simplifiedStr);
                    }
                }
                resultLaTeX = `\\text{Result: } ` + resultLaTeX;
            }

            renderKatex(resultLaTeX, pOut, { throwOnError: false });
            solId.appendChild(pOut);
            if (typeof window !== 'undefined') {
                window.mathSolverLastSolution = resultLaTeX;
            }
            saveSolutionToHistory(user_input, resultLaTeX);
        }
    } catch (e) {
        console.error("Error in mathSolver:", e);
        const pErr = document.createElement('p');
        pErr.innerText = `Could not parse/solve expression: ${e.message}`;
        solId.appendChild(pErr);
        if (typeof window !== 'undefined') {
            window.mathSolverLastSolution = "";
        }
    }

    if (typeof document !== 'undefined') {
        const mathEl = document.getElementById("math");
        if (mathEl) {
            // Signal that a solve just ran so updateMathOverlay fires the height-fit exactly once
            if (typeof window !== 'undefined') window._mathSolveJustRan = true;
            resizeTextarea(mathEl);
            updateMathOverlay();
        }
    }
}

function getODEOrder(odeStr) {
    let maxOrder = 0;
    // 1. Check for primes: y followed by primes
    let primeMatches = odeStr.match(/y'+/g);
    if (primeMatches) {
        for (let m of primeMatches) {
            let order = m.length - 1; // since it starts with 'y', order is number of primes
            if (order > maxOrder) maxOrder = order;
        }
    }

    // 2. Check for Leibniz notation: d^N y or d y
    let dMatches = odeStr.match(/d\^?(\d+)?y/g);
    if (dMatches) {
        for (let m of dMatches) {
            let order = 1;
            let matchPower = m.match(/d\^(\d+)/);
            if (matchPower) {
                order = parseInt(matchPower[1]);
            }
            if (order > maxOrder) maxOrder = order;
        }
    }
    // Check for general dy
    if (odeStr.includes('dy') || odeStr.includes('d(y)')) {
        if (maxOrder < 1) maxOrder = 1;
    }

    // 3. Check for Operator notation: D^N y or D y
    let dCapMatches = odeStr.match(/D\^?(\d+)?\*?y/g);
    if (dCapMatches) {
        for (let m of dCapMatches) {
            let order = 1;
            let matchPower = m.match(/D\^(\d+)/);
            if (matchPower) {
                order = parseInt(matchPower[1]);
            }
            if (order > maxOrder) maxOrder = order;
        }
    }
    if (odeStr.includes('Dy') || odeStr.includes('D(y)')) {
        if (maxOrder < 1) maxOrder = 1;
    }

    return maxOrder;
}

function parseInitialCondition(condStr) {
    let clean = condStr.replace(/\s+/g, '');
    let match = clean.match(/^y('*)?\(?(-?\d+(?:\.\d+)?)\)?=(.+)$/);
    if (!match) return null;
    let primes = match[1] || '';
    let order = primes.length;
    let x0 = parseFloat(match[2]);
    let val = match[3];
    return { order, x0, val };
}

function validateInitialConditions(conds, N) {
    if (!conds || conds.length !== N) return false;
    let x0 = conds[0].x0;
    let orderSet = new Set();
    for (let c of conds) {
        if (!c) return false;
        if (c.x0 !== x0) {
            console.log(`Initial conditions evaluated at different points: ${c.x0} vs ${x0}`);
            return false;
        }
        if (c.order < 0 || c.order >= N) {
            console.log(`Initial condition derivative order ${c.order} is out of bounds for ODE order ${N}`);
            return false;
        }
        orderSet.add(c.order);
    }
    return orderSet.size === N;
}

function solveInitValue(firstODEsol, parsedConds) {
    console.log("solveInitValue called with general solution:", firstODEsol, "and conditions:", parsedConds);
    if (!firstODEsol || !parsedConds || parsedConds.length === 0) {
        return null;
    }

    let eqParts = firstODEsol.split('=');
    let rhsExpr = eqParts[1] ? eqParts[1].trim() : eqParts[0].trim();

    // 1. Rename C -> C_0, const_e -> e to avoid conflicts/differentiations issues
    let renamedExpr = rhsExpr.replace(/\bC\b/g, 'C_0').replace(/\bconst_e\b/g, 'e');

    // 2. Identify the constants in the renamed general solution
    let matches = renamedExpr.match(/\bC_\d+\b/g) || [];
    let uniqueConstants = [...new Set(matches)];

    if (uniqueConstants.length === 0) {
        console.log("No constants found in general solution to solve for.");
        return null;
    }

    // 3. Set up derivative expressions
    let maxDeriv = 0;
    for (let cond of parsedConds) {
        if (cond.order > maxDeriv) maxDeriv = cond.order;
    }

    let derivExprs = [];
    derivExprs[0] = renamedExpr;
    for (let k = 1; k <= maxDeriv; k++) {
        try {
            derivExprs[k] = nerdamer(`diff(${derivExprs[k - 1]}, x)`).toString();
        } catch (e) {
            console.error(`Error computing derivative of order ${k}:`, e);
            return null;
        }
    }

    // 4. Generate equations by substituting x = x0
    let eqs = [];
    let evalInfos = [];
    for (let cond of parsedConds) {
        let derivExpr = derivExprs[cond.order];
        if (!derivExpr) {
            console.error(`Missing derivative expression for order ${cond.order}`);
            return null;
        }

        let derivLaTeX = nerdamer(derivExpr).toTeX();

        let evalExpr;
        try {
            evalExpr = nerdamer(derivExpr).sub('x', cond.x0.toString()).simplify().toString();
        } catch (e) {
            console.error(`Error substituting x = ${cond.x0} in derivative:`, e);
            return null;
        }

        let evalLaTeX = nerdamer(evalExpr).toTeX();
        eqs.push(`(${evalExpr}) - (${cond.val}) = 0`);

        let derivName = "y";
        if (cond.order === 1) derivName = "y'";
        else if (cond.order === 2) derivName = "y''";
        else if (cond.order > 2) derivName = `y^{(${cond.order})}`;

        evalInfos.push({
            derivName,
            x0: cond.x0,
            val: cond.val,
            derivLaTeX,
            evalLaTeX
        });
    }

    // 5. Solve the linear system
    let solution = [];
    try {
        solution = nerdamer.solveEquations(eqs);
    } catch (e) {
        console.error("Error in nerdamer.solveEquations:", e);
        return null;
    }

    let solvedConstants = {};
    if (solution.length > 0) {
        if (Array.isArray(solution[0])) {
            for (let sol of solution) {
                solvedConstants[sol[0]] = sol[1].toString();
            }
        } else {
            let varName = solution[0];
            let valObj = solution[1];
            if (Array.isArray(valObj)) {
                valObj = valObj[0];
            }
            solvedConstants[varName] = valObj.toString();
        }
    } else {
        console.log("No solution returned by solveEquations");
        return null;
    }

    // 6. Build intermediate steps LaTeX
    let stepsLaTeX = [];

    for (let info of evalInfos) {
        stepsLaTeX.push(`\\text{For } ${info.derivName}(${info.x0}) = ${info.val}: \\quad ${info.derivName}(x) = ${info.derivLaTeX}`);
        stepsLaTeX.push(`\\implies ${info.derivName}(${info.x0}) = ${info.evalLaTeX} = ${info.val}`);
    }

    let systemLines = evalInfos.map(info => `${info.evalLaTeX} = ${info.val}`);
    stepsLaTeX.push(`\\text{System of equations: } \\begin{cases} ` + systemLines.join(' \\\\ ') + ` \\end{cases}`);

    let solvedLines = [];
    for (let c of uniqueConstants) {
        let val = solvedConstants[c];
        if (val === undefined) {
            console.log(`Constant ${c} was not solved for.`);
            return null;
        }
        let valTeX = nerdamer(val).toTeX();
        let dispName = c;
        if (c === 'C_0' && !rhsExpr.includes('C_0') && rhsExpr.includes('C')) {
            dispName = 'C';
        }
        solvedLines.push(`${dispName} = ${valTeX}`);
    }
    stepsLaTeX.push(`\\text{Solving for constants yields: } ` + solvedLines.join(',\\quad '));

    // 7. Construct particular solution
    let particularExpr = renamedExpr;
    for (let c in solvedConstants) {
        particularExpr = nerdamer(particularExpr).sub(c, solvedConstants[c]).toString();
    }

    let stepStr = stepsLaTeX.join(' \\\\\\\\ ');
    let particSolStr = 'y = ' + particularExpr;

    return {
        stepsLaTeX: stepStr,
        particularSolution: particSolStr
    };
}

function checkFalsedx(input) {
    let output;
    let cleanInput = input.replace(/diff/g, '')
        .replace(/product/g, '')
        .replace(/prod/g, '')
        .replace(/defint/g, '');
    let eachVarExp = cleanInput.split(/[+\-*=]/);
    let d_count = eachVarExp.map(item => item.split('d').length - 1);
    d_count = d_count.reduce((a, b) => a + b, 0);
    if (d_count % 2 !== 0) {
        window.alert(`Invalid expression: diff. operator mismatch`);
        throw new Error(`invalid use of diff operators`);
    }
    else {
        if (!input.includes('d^')) {
            output = input.replaceAll('dx', '1').replaceAll('dy', 'dy/dx');
        }
        else {
            output = input;
        }
    }
    return output;
}

function clearSolution() {
    if (typeof document === 'undefined') return;
    let ode = document.getElementById("ode");
    if (ode) {
        ode.value = '';
        ode.style.width = '400px';
        ode.style.height = '60px';
    }
    let math = document.getElementById("math");
    if (math) {
        math.value = '';
        math.style.width = '400px';
        math.style.height = '60px';
        // Also reset the container so width doesn't carry over from previous input
        const container = math.closest('.ode-input-container');
        if (container) container.style.width = '400px';
    }
    let overlay = document.getElementById("ode-math-overlay");
    if (overlay) {
        overlay.style.width = '396px';
        overlay.style.height = '56px';
        overlay.innerHTML = '';
    }
    let solution = document.getElementById("solution");
    if (solution) {
        solution.innerHTML = '';
    }
    // Hide tab row and output area on clear
    const outputRow = document.getElementById('outputRow');
    if (outputRow) outputRow.style.display = 'none';
    const panelTabRow = document.getElementById('panelTabRow');
    if (panelTabRow) panelTabRow.style.display = 'none';
}

function dydx_To_Y1(dydx) {
    let ord_arr = dydx.split('d^').slice(1).map(item => {
        let m = item.match(/\d+/);
        return m ? m[0] : null;
    }).filter(Boolean);
    ord_arr = [...new Set(ord_arr)];
    console.log(`The order in ${dydx}: ${ord_arr}`);
    let Y = dydx;
    for (let ord of ord_arr) {
        // Replace numerator: d^ord*y, d^ordy, d^(ord)*y, d^(ord)y, etc.
        let numRegex = new RegExp(`d\\^(?:${ord}|\\(${ord}\\))\\*?y`, 'g');
        Y = Y.replace(numRegex, `Y${ord}`);

        // Replace denominator: /dx^ord, /(dx^ord), /dx^(ord), /(dx^(ord))
        let denRegex = new RegExp(`\\/(?:\\(\\s*dx\\^(?:${ord}|\\(${ord}\\))\\s*\\)|\\s*dx\\^(?:${ord}|\\(${ord}\\)))`, 'g');
        Y = Y.replace(denRegex, '');

        // Replace dx^-ord or dx^(-ord)
        let denNegRegex = new RegExp(`dx\\^(?:-${ord}|\\(-${ord}\\))`, 'g');
        Y = Y.replace(denNegRegex, '');
    }
    console.log(`For  dydx_To_Y1(${dydx}) : ${Y}`);
    return Y;
}

//Swapping x and y 
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

//Check for dx/dy
function xy_checkReplace(input) {
    if (!input || typeof input !== 'string' || !input.trim()) {
        return ['', false];
    }

    // 1. Leibniz notation: dx/dy or d^n x / dy^n 
    const isLeibnizX = /\/\s*d(\^\d+)?\(?y\)?(\^\d+)?\b/i.test(input);

    // 2. Prime notation: x', x'', etc.
    const isPrimeX = /\bx'+/i.test(input);

    // 3. Operator notation: Dx, D^1x, D^2x, etc.
    const isOperatorX = /\bD(\^\d+)?x\b/.test(input);

    //x is the differentiable variable 
    if (isLeibnizX || isPrimeX || isOperatorX) {
        console.log(`Detected x as the differentiable variable. Swapping x and y...`);
        const swappedInput = swapXY(input);
        console.log(`Swapped equation: ${swappedInput}`);
        return [swappedInput, true];
    }

    console.log(`Detected y as the differentiable variable (default). No swap needed.`);
    return [input, false];
}

//Validating paranthesis
function paranthesisValidation(inp_str) {

    console.log(`paranthesisValidation(${inp_str}) called`);

    //Adding default exponents
    inp_str = inp_str.replaceAll('dy', 'd^1y').replaceAll('Dy', 'D^1y');
    inp_str = inp_str.replaceAll('d(', 'd^1(');
    inp_str = inp_str.replaceAll('dx^', 'DX');
    inp_str = inp_str.replaceAll('dx', 'dx^1');
    inp_str = inp_str.replaceAll('DX', 'dx^');
    inp_str = inp_str.replaceAll('"', "''");

    inp_str = inp_str.replaceAll('{', '(').replaceAll('[', '(');
    inp_str = inp_str.replaceAll('}', ')').replaceAll(']', ')');

    console.log(`inp_str after parenthesisValdation : ${inp_str}`);

    let parExp, operExp, factIndex, operIndex = [];
    let validExp = false; let parLIndex, parRIndex, factor;

    //Checking valid assignment
    if (!inp_str.includes('=')) {
        console.log(`Missing "=" assignment in ${inp_str}`);
        if (typeof window !== 'undefined') window.alert('Enter Valid Expression "=" missing');
        throw new Error("Missing assignment operator");
    }
    else {
        if (inp_str.slice(inp_str.indexOf('=')) == '') {
            console.log(`Missing variable after "=" assignment in ${inp_str}`);
            if (typeof window !== 'undefined') window.alert('Enter Valid Expression : assignment missing');
            throw new Error("Missing assignment");
        }
        if (inp_str.split('=').length - 1 > 1) {
            console.log(`More than one "=" assignment in ${inp_str}`);
            if (typeof window !== 'undefined') window.alert('Enter Valid Expression : >1 "=" assignment');
            throw new Error("More than one '=' assignment found");
        }
    }

    //Expanding terms and checking validity
    if (/[(]/.test(inp_str)) {
        let L_brackets = inp_str.split(/[(]/).length - 1;
        let R_brackets = inp_str.split(/[)]/).length - 1;
        if (L_brackets !== R_brackets) {
            console.log(`L_brackets: ${L_brackets} not equal to R_brackets: ${R_brackets}`);
            if (typeof window !== 'undefined') window.alert("Invalid Expression");
            throw new Error("Invalid expression: Close Parenthesis properly");
        }
        else {
            for (let i = 0; i < inp_str.length; i++) {
                if (inp_str[i] == '(' && inp_str[i + 1] == ')') {
                    console.log(`Empty parenthesis found @ ${i}`);
                    if (typeof window !== 'undefined') window.alert("Empty parenthesis found");
                    throw new Error("Invalid Expression found: Empty Parenthesis found");
                }
                else {
                    validExp = true;
                }
            }
            if (validExp == true) {
                if (inp_str.includes('D')) {
                    let inpLRstr = inp_str.split('=');
                    let inpLstr = inpLRstr[0];
                    let inpRstr = inpLRstr[1];
                    inpLstr = nerdamer(`expand(${inpLstr})`).toString();
                    inpRstr = nerdamer(`expand(${inpRstr})`).toString();
                    inp_str = inpLstr + '=' + inpRstr;
                    console.log(`Expanded D expression : ${inp_str}`);
                }
                console.log(`Final inp_str after nerdamer expansion : ${inp_str}`);
            }
        }
    }
    return inp_str;
}

//Validate Order of ODE
function orderValidation(inp_exp) {

    console.log("Checking for valid order");

    if (inp_exp.includes('diff(')) return true;

    let cleanInp = inp_exp.replace(/diff/g, '')
        .replace(/product/g, '')
        .replace(/prod/g, '')
        .replace(/defint/g, '');

    if (cleanInp.includes('d') && cleanInp.includes('D')) {
        console.log('Both d & D are found in the same expression');
        return false;
    }
    else if (cleanInp.includes('D') && cleanInp.includes("y'")) {
        console.log("Both D and y' found in same expression");
        return false;
    }
    else if (cleanInp.includes('d')) {
        console.log('d exp found, Checking available order of ODE');
        let parts = cleanInp.split('d^').slice(1);
        console.log(`Expression was split at d^ into ${parts}`);
        let y_index = parts.map(item => item.indexOf('y'));
        console.log(`Found index of y in expression : ${y_index}`);
        if (y_index.includes(-1)) {
            console.log('Missing y after d in the expression');
            return false;
        }
        else {
            let filtered = parts.map(item => item.slice(0, item.indexOf('y'))).filter(item => item.includes('.') || !/[0-9]/.test(item[0]));
            console.log(`Checking for valid order in expression => Available orders : ${filtered}`);
            let isValid = filtered.length == 0 ? true : false;
            console.log(`All available orders are valid ? ${isValid}`);
            return isValid;
        }
    }
    else if (cleanInp.includes('D')) {
        console.log('D exp found, Checking available order of ODE');
        let parts = cleanInp.split('D^').slice(1);
        console.log(`Expression was split at D^ into ${parts}`);
        let filtered = parts.map(item => item.slice(0, item.indexOf('y'))).filter(item => item.includes('.') || !/[0-9]/.test(item[0]));
        console.log(`Checking for invalid order in expression => Invalid orders : ${filtered == '' ? 0 : filtered}`);
        let isValid = filtered.length == 0 ? true : false;
        console.log(`All available orders are valid ? ${isValid}`);
        return isValid;
    }
    else {
        console.log(`All available orders are valid ? ${true}`);
        return true;
    }
}

//Modify input into differential form
function modify_inp(input) {

    console.log(`Modifying input String: modify_inp(${input})`);

    let modified_output = input;

    if (input.includes('d')) {
        console.log(`Only d found => modified string : ${input}`);
        modified_output = input;
    }
    else if (input.includes('D')) {
        // First, replace any D^n*y or D^ny with Y + n primes
        let modified = input.replace(/D\^(\d+)\*?y/g, (match, p1) => {
            let order = parseInt(p1);
            return 'Y' + "'".repeat(order);
        });
        // Then, replace any D*y or Dy with Y'
        modified = modified.replace(/D\*?y/g, "Y'");

        // Replace Y with y
        modified_output = modified.replaceAll('Y', 'y');

        let dydxinp = modified_output;
        modified_output = dydx(dydxinp).replaceAll('\)*', '\)');
        console.log(`Found only D => Modified string : ${modified_output}`);
    }
    else {
        modified_output = dydx(input);
        console.log(`Modified String after converting y' to dy/dx : ${modified_output}`);
    }
    return modified_output;
}

//Convert to dy/dx form
function dydx(inpt) {
    console.log(`dydx(${inpt}) function used for converting y' to dy/dx`);
    let mod_output = inpt;
    let order_ar = [];
    inpt = inpt.replaceAll("'y", "'*y");
    console.log(`After replacing 'y with *y, modified string : ${inpt}`);
    let diffOper = inpt.split(/[+\-*/=]/);
    console.log(`String was split at operators +-/* to get diffOper : ${diffOper}`);
    order_ar = diffOper.map(item => item.split("'").length - 1).filter(item => !isNaN(item));
    order_ar = [...new Set(order_ar)];
    order_ar = order_ar.filter(item => item !== 0);
    order_ar.sort((a, b) => b - a);
    console.log(`Sorted array order : ${order_ar}`);
    for (let ords of order_ar) {
        mod_output = mod_output.replaceAll("y" + "'".repeat(ords), `(d^${ords}Y/dx^${ords})`);
    }
    mod_output = mod_output.replaceAll('Y', 'y').replaceAll("'", '');
    return mod_output;
}

//Validate Expression
function validExpression(inp) {

    console.log(`Checking Expression Validity: validExpression(${inp})`);

    if (inp.includes('diff(')) return true;

    let D_counts, y_count, dy_count, dx_count, ord_count = [];

    // Clean function names containing 'd' to avoid false operator mismatch alerts
    let cleanInp = inp.replace(/diff/g, '')
        .replace(/product/g, '')
        .replace(/prod/g, '')
        .replace(/defint/g, '');

    if (cleanInp.includes('d')) {
        ord_count = cleanInp.split('d^').slice(1).map(item => parseInt(item.match(/^\d+/)[0])).filter(item => !isNaN(item) && item !== 0);
        ord_count = [...new Set(ord_count)];
        console.log(`input includes d and available orders : ${ord_count}`);

        if (ord_count.length == 0) {
            console.log(`Missing numbers in order array: Invalid Order`);
            if (typeof window !== 'undefined') window.alert('Invalid order of ODE');
            return false;
        }

        for (let ord of ord_count) {

            dy_count = cleanInp.split(`d^${ord}`).length - 1;
            dx_count = cleanInp.split(`dx^${ord}`).length - 1;

            if (dy_count !== dx_count) {
                console.log(`Order mismatch found @ ${ord}: dy_count: ${dy_count} != dx_count: ${dx_count}`);
                if (typeof window !== 'undefined') window.alert('invalid order of ODE');
                return false;
            }
        }
        console.log(`d expression is valid`);
        return true;
    }

    if (cleanInp.includes('D')) {

        D_counts = cleanInp.split(/[+\-/=]/);
        for (let D_count of D_counts) {
            if (D_count.includes('D')) {
                if (D_count.includes('y')) {
                    return true;
                }
                else {
                    console.log(`Missing y at ${D_count}`);
                    if (typeof window !== 'undefined') window.alert("Invalid Order");
                    return false;
                }
            }
        }
    }

    if (cleanInp.includes("y'")) {
        console.log(`Expression ${inp} includes only y' & is valid`);
        return true;
    }
}

function singleOrderCheck(problem) {
    let numofDiffs = problem.split('Y').length - 1;
    let numOrders = problem.split('Y').slice(1).map(item => parseInt(item));
    numUniqOrders = [...new Set(numOrders)];

    if (numUniqOrders.length == 1) {
        let order = parseInt(numUniqOrders.join(''));
        if (order === 1) {
            console.log(`It is single order ODE`);
            console.log(`The order is ${order}`);
            return [true, order];
        }
    }
    console.log(`It is not single order ODE`);
    return [false, ''];
}

function TotalIntegration(expr, diffvar, order) {
    let sol = expr;
    for (i = 1; i <= order; i++) {
        sol = nerdamer(`integrate(${sol}, ${diffvar})`).toString();
    }
    return sol;
}


function parseExactSol(exact_sol) {
    if (!exact_sol || typeof exact_sol !== 'string') return null;
    if (exact_sol.startsWith('[') && exact_sol.endsWith(']')) {
        let content = exact_sol.slice(1, -1);
        let depth = 0;
        let commaIdx = -1;
        for (let i = 0; i < content.length; i++) {
            if (content[i] === '(' || content[i] === '[') depth++;
            else if (content[i] === ')' || content[i] === ']') depth--;
            else if (content[i] === ',' && depth === 0) {
                commaIdx = i;
                break;
            }
        }
        if (commaIdx !== -1) {
            let IF = content.slice(0, commaIdx).trim();
            let u = content.slice(commaIdx + 1).trim();
            return { IF, u };
        }
    }
    return null;
}

function cleanSolveResult(expr) {
    if (!expr || typeof expr !== 'string') return expr;

    // Reject corrupted rationalized 'e' solutions containing large Nerdamer rationalizer digits
    if (expr.includes('119696244') || expr.includes('325368125')) {
        console.log("Detected rationalized e corruption inside cleanSolveResult");
        return '0';
    }

    if (expr.includes('=')) {
        let parts = expr.split('=');
        return parts.map(p => cleanSolveResult(p)).join('=');
    }

    // 1. Substitute the built-in constant "e" with a temporary symbol "const_e"
    // to prevent Nerdamer from evaluating it to a 70-digit decimal.
    let safe = expr.replace(/\be\b/g, 'const_e');

    // 2. Simplify e^(...) powers containing logs
    let idx = safe.indexOf('const_e^(');
    while (idx !== -1) {
        let bracketCount = 1;
        let j = idx + 9;
        while (j < safe.length && bracketCount > 0) {
            if (safe[j] === '(') bracketCount++;
            else if (safe[j] === ')') bracketCount--;
            j++;
        }
        if (bracketCount === 0) {
            let exponent = safe.slice(idx + 9, j - 1);
            let fullMatch = safe.slice(idx, j);
            try {
                if (exponent.includes('log')) {
                    let terms = getTerms(exponent);
                    let prod = terms.map(t => 'exp(' + t + ')').join('*');
                    let simplifiedExp = nerdamer(prod).simplify().toString();
                    simplifiedExp = simplifiedExp.replace(/\be\b/g, 'const_e');
                    safe = safe.replace(fullMatch, simplifiedExp);
                    idx = safe.indexOf('const_e^(', idx + simplifiedExp.length);
                } else {
                    idx = safe.indexOf('const_e^(', idx + 1);
                }
            } catch (e) {
                idx = safe.indexOf('const_e^(', idx + 1);
            }
        } else {
            idx = safe.indexOf('const_e^(', idx + 1);
        }
    }

    // 3. Expand the simplified expression to distribute front factors
    safe = nerdamer(safe).expand().toString();

    // 4. Find and factor arguments inside sqrt(...) to pull out constants like 4*e^2
    idx = safe.indexOf('sqrt(');
    while (idx !== -1) {
        let bracketCount = 1;
        let j = idx + 5;
        while (j < safe.length && bracketCount > 0) {
            if (safe[j] === '(') bracketCount++;
            else if (safe[j] === ')') bracketCount--;
            j++;
        }
        if (bracketCount === 0) {
            let inner = safe.slice(idx + 5, j - 1);
            let fullMatch = safe.slice(idx, j);
            try {
                let factoredInner = nerdamer(`factor(${inner})`).toString();
                safe = safe.replace(fullMatch, `sqrt(${factoredInner})`);
                idx = safe.indexOf('sqrt(', idx + factoredInner.length + 6);
            } catch (e) {
                idx = safe.indexOf('sqrt(', idx + 1);
            }
        } else {
            idx = safe.indexOf('sqrt(', idx + 1);
        }
    }

    // 5. Expand once more to pull out factors from sqrt
    safe = nerdamer(safe).expand().toString();

    // 6. Simplify the abs(const_e) * const_e^(-1) to 1
    if (safe.includes('abs(const_e)') || safe.includes('log(const_e)')) {
        safe = safe.replaceAll('abs(const_e)*const_e^(-1)', '1')
            .replaceAll('abs(const_e)*const_e^-1', '1');

        // 6.5 Simplify again to eliminate "1*"
        safe = nerdamer(safe).simplify().toString();

        // 6.6 Substitute log(const_e) with 1
        safe = safe.replaceAll('log(const_e)', '1');
        safe = nerdamer(safe).simplify().toString();
    }

    // 7. Restore "const_e" back to "e"
    safe = safe.replace(/\bconst_e\b/g, 'e');
    safe = safe.replaceAll('log(e)', '1');

    // 8. Detect and fix Nerdamer's trig simplification sign-flip bug
    try {
        let orig_val = Number(nerdamer(expr.replace(/\bconst_e\b/g, 'e')).sub('x', '0.5').sub('y', '0.5').evaluate().text());
        let simp_val = Number(nerdamer(safe).sub('x', '0.5').sub('y', '0.5').evaluate().text());
        if (!isNaN(orig_val) && !isNaN(simp_val) && orig_val !== 0 && simp_val !== 0) {
            if ((orig_val > 0 && simp_val < 0) || (orig_val < 0 && simp_val > 0)) {
                safe = `-(${safe})`;
            }
        }
    } catch (e) { }

    return safe;
}

function separateFactors(expr) {
    try {
        let factored = nerdamer(`factor(${expr})`).toString();
        let depth = 0;
        let bracketDepth = 0;
        const factors = [];
        let start = 0;

        for (let i = 0; i <= factored.length; i++) {
            if (i < factored.length) {
                let char = factored[i];
                if (char === '(') depth++;
                else if (char === ')') depth--;
                else if (char === '[') bracketDepth++;
                else if (char === ']') bracketDepth--;
            }

            if (i === factored.length || (factored[i] === '*' && depth === 0 && bracketDepth === 0)) {
                let factor = factored.slice(start, i).trim();
                if (factor) {
                    factors.push(factor);
                }
                start = i + 1;
            }
        }

        let xFactors = [];
        let yFactors = [];
        let constFactors = [];

        for (let factor of factors) {
            let hasX = factor.includes('x');
            let hasY = factor.includes('y');

            if (hasX && hasY) {
                return null;
            } else if (hasX) {
                xFactors.push(factor);
            } else if (hasY) {
                yFactors.push(factor);
            } else {
                constFactors.push(factor);
            }
        }

        let xPart = xFactors.length > 0 ? xFactors.join('*') : '1';
        let yPart = yFactors.length > 0 ? yFactors.join('*') : '1';
        let constPart = constFactors.length > 0 ? constFactors.join('*') : '1';

        if (constPart !== '1') {
            xPart = `${constPart}*(${xPart})`;
        }

        return { xPart, yPart };
    } catch (e) {
        return null;
    }
}


//Solving the Single Order ODE equation
function solveSingleOrder(problem) {
    let problem_const_e = problem.replace(/\be\b/g, 'const_e');
    let res = _solveSingleOrder(problem_const_e);
    if (res && typeof res === 'string') {
        res = res.replace(/\bconst_e\b/g, 'e');
    }
    return res;
}

function _solveSingleOrder(problem) {

    console.log(`solveSingleOrder(${problem})`);
    singleCheck = singleOrderCheck(problem);
    singleOrdCheck = singleCheck[0];
    replaceOrder = singleCheck[1];
    console.log(`replaceOrder : ${replaceOrder}, ${singleCheck}`);

    // 0. Priority check: if d^n y/dx^n = f(x) with no y present → directly integrable (separable form)
    try {
        let yDerivs = problem.match(/Y\d+/g) || [];
        let uniqueDerivs = [...new Set(yDerivs)];
        if (uniqueDerivs.length === 1) {
            let Yn = uniqueDerivs[0];
            let n = parseInt(Yn.slice(1));
            let tempEq = problem.replace(new RegExp(Yn, 'g'), 'TEMP_VAR');
            let hasStandaloneY = /\by\b/.test(tempEq) || /\bY\b/.test(tempEq);
            if (!hasStandaloneY) {
                let eqForSep = problem.split('=').join('-(') + ')';
                let rhsRaw = nerdamer(`solve(${eqForSep}, ${Yn})`).toString()
                    .replaceAll('[', '').replaceAll(']', '').trim();
                // Ensure RHS solved successfully and does not contain y or Y
                if (rhsRaw && !rhsRaw.includes('y') && !/Y\d+/.test(rhsRaw) && !rhsRaw.includes('TEMP_VAR')) {
                    // Integrate f(x) n times to build y
                    let integrated = rhsRaw;
                    let integSteps = [];
                    for (let k = 0; k < n; k++) {
                        let before = integrated;
                        integrated = nerdamer(`integrate(${integrated}, x)`).toString();
                        integSteps.push({ order: n - k, integrand: before, result: integrated });
                    }

                    // Build the arbitrary-constant tail: C for n=1, otherwise C_1*x^(n-1) + C_2*x^(n-2) + ... + C_n
                    let constTerms = [];
                    if (n === 1) {
                        constTerms.push('C');
                    } else {
                        for (let k = 1; k <= n; k++) {
                            let power = n - k;
                            if (power === 0) {
                                constTerms.push(`C_${k}`);
                            } else if (power === 1) {
                                constTerms.push(`C_${k}*x`);
                            } else {
                                constTerms.push(`C_${k}*x^${power}`);
                            }
                        }
                    }
                    let fullSol = integrated + (constTerms.length ? ' + ' + constTerms.join(' + ') : '');

                    // Build step LaTeX
                    try {
                        let fTeX = nerdamer(rhsRaw).toTeX();
                        if (n === 1) {
                            separable_form_step = `\\text{Separable ODE: } \\frac{dy}{dx} = ${fTeX}`;
                            separable_sol_step = `\\text{Separating variables: } dy = (${fTeX})\\,dx`;
                            separable_separated_step = `\\text{Integrating both sides: } \\int dy = \\int (${fTeX})\\,dx`;
                            separable_integration_step = `\\text{General solution: } y = ${nerdamer(integrated).toTeX()} + C`;
                        } else {
                            // Build step-by-step for higher orders
                            separable_form_step = `\\text{Direct Integration: } \\frac{d^{${n}}y}{dx^{${n}}} = ${fTeX}`;

                            let stepsTeX = [];
                            for (let idx = 0; idx < n; idx++) {
                                let order = n - idx;
                                let nextOrder = order - 1;
                                let dLabel = order === 1 ? `\\frac{dy}{dx}` : `\\frac{d^{${order}}y}{dx^{${order}}}`;
                                let dLabelNext = nextOrder === 1 ? `\\frac{dy}{dx}` : nextOrder === 0 ? `y` : `\\frac{d^{${nextOrder}}y}{dx^{${nextOrder}}}`;

                                // Build RHS for step idx (all integrations up to step idx plus constants)
                                let stepPureInteg = integSteps[idx].result;
                                let stepConsts = [];
                                for (let k = 1; k <= idx + 1; k++) {
                                    let power = (idx + 1) - k;
                                    let constName = `C_{${k}}`;
                                    if (power === 0) {
                                        stepConsts.push(constName);
                                    } else if (power === 1) {
                                        stepConsts.push(`${constName} x`);
                                    } else {
                                        stepConsts.push(`${constName} x^{${power}}`);
                                    }
                                }
                                let stepRHSTeX = nerdamer(stepPureInteg).toTeX() + ' + ' + stepConsts.join(' + ');

                                // RHS of the input equation of the integration
                                let prevRHSTeX = "";
                                if (idx === 0) {
                                    prevRHSTeX = fTeX;
                                } else {
                                    let prevPureInteg = integSteps[idx - 1].result;
                                    let prevConsts = [];
                                    for (let k = 1; k <= idx; k++) {
                                        let power = idx - k;
                                        let constName = `C_{${k}}`;
                                        if (power === 0) {
                                            prevConsts.push(constName);
                                        } else if (power === 1) {
                                            prevConsts.push(`${constName} x`);
                                        } else {
                                            prevConsts.push(`${constName} x^{${power}}`);
                                        }
                                    }
                                    prevRHSTeX = nerdamer(prevPureInteg).toTeX() + ' + ' + prevConsts.join(' + ');
                                }

                                stepsTeX.push(`\\text{Integrate (step ${idx + 1}): } ${dLabel} = ${prevRHSTeX} \\implies ${dLabelNext} = ${stepRHSTeX}`);
                            }

                            separable_sol_step = stepsTeX.join(' \\\\\\ ');
                            separable_separated_step = '';
                            separable_integration_step = `\\text{General solution: } y = ${nerdamer(integrated).toTeX()} + ` + constTerms.map(t => nerdamer(t).toTeX()).join(' + ');
                        }
                    } catch (e) {
                        console.error('Error building direct-integration step LaTeX:', e);
                    }

                    return `y = ${cleanSolveResult(fullSol)}`;
                }
            }
        }
    } catch (e) {
        console.error('Direct-integration pre-check error:', e);
    }

    singleCheck = singleOrderCheck(problem);
    singleOrdCheck = singleCheck[0];
    replaceOrder = singleCheck[1];
    console.log(`replaceOrder : ${replaceOrder}, ${singleCheck}`);

    if (!singleOrdCheck) {
        //Attempting to solve higher order ODE equation
        let sol = higherOrderODEsolver(problem);
        return sol;
    }

    //1. Attemping to solve linear ode first
    let solLin_Y = linearODEsolver(problem);
    if (solLin_Y !== '0') {
        return solLin_Y;
    }

    // 2. Attempt direct exact / integrating factor solver on the unsolved problem form first!
    let problem_std = problem.replaceAll(`Y${replaceOrder}`, 'Y1');
    let direct_sol = directExactSolver(problem_std, false);
    if (direct_sol && direct_sol !== '0') {
        if (direct_sol.startsWith('[')) {
            let parsed = parseExactSol(direct_sol);
            if (parsed) {
                direct_sol = parsed.u;
            }
        }
        let ode_sol = TotalIntegration(direct_sol, 'x', replaceOrder - 1);
        return ode_sol + '=' + 'C';
    }

    problem = problem.replaceAll(`Y${replaceOrder}`, `(Y${replaceOrder})`);
    let dyBydx, dx, dy, num, den, expr, ode_sol;

    if (singleOrdCheck) {

        let sol_Y = solveLinearY(problem, `Y${replaceOrder}`);
        if (!sol_Y) {
            sol_Y = nerdamer(`solve(${problem}, Y${replaceOrder})`).toString();
            sol_Y = sol_Y.replaceAll('[', '').replaceAll(']', '');
        }
        let raw_sol_arr = sol_Y.split(',');
        console.log(`After solving for Y${replaceOrder}: ${raw_sol_arr}`)

        // Filter out extraneous solutions
        let problem_lhs = problem.split('=')[0];
        console.log(`problem_lhs: ${problem_lhs}`);
        let validated_sol_arr = raw_sol_arr.filter(item => {
            try {
                let sub_expr = nerdamer(problem_lhs).sub(`Y${replaceOrder}`, item).simplify().toString();
                return sub_expr === '0';
            } catch (e) {
                return true;
            }
        });

        if (validated_sol_arr.length === 0) {
            validated_sol_arr = raw_sol_arr;
        }

        partSol = validated_sol_arr.map(item => {
            item = item + '=' + `Y${replaceOrder}`;
            expr = item.replace(`Y${replaceOrder}`, 'dy/dx');
            console.log(`The expression passed to nerdamerTest() is ${expr}`)

            let isSeperable = nerdamerTest(expr);
            console.log(`Seperability of given 1st order ODE : ${isSeperable}`);
            if (isSeperable) {
                dyBydx = tobeInteg;
                console.log(`dy/dx = ${tobeInteg}`);
                let isHomogeneous = tobeInteg.includes('u');
                let dyLHS, dxRHS;
                if (isHomogeneous) {
                    let dyExpr = `1/(${tobeInteg})`;
                    let simplified = nerdamer(dyExpr).simplify().toString();
                    let num = nerdamer(simplified).numerator().expand().toString();
                    let den = nerdamer(simplified).denominator().expand().toString();
                    dy = `(${num})/(${den})`;
                    dx = `1/x`;
                    console.log(`integrate(${dy}, u), integrate(${dx},x)`);
                    dyLHS = TotalIntegration(dy, 'u', replaceOrder);
                    dyLHS = nerdamer(dyLHS).sub('u', 'y/x').toString();
                    dxRHS = TotalIntegration(dx, 'x', replaceOrder);

                    try {
                        separable_form_step = `\\text{Homogeneous first-order ODE form: } y' = f(y/x)`;
                        separable_sol_step = `\\text{General solution form: } \\int \\frac{du}{f(u) - u} = \\ln|x| + C \\quad \\text{where } u = y/x`;
                        separable_separated_step = `\\text{Homogeneous Substitution: } y = u \\cdot x \\implies \\text{Separated Form: } (${nerdamer(dy).toTeX()}) du = (${nerdamer(dx).toTeX()}) dx`;
                        separable_integration_step = `\\text{Integrating both sides: } \\int (${nerdamer(dy).toTeX()}) du = \\int (${nerdamer(dx).toTeX()}) dx \\implies ${nerdamer(dyLHS).toTeX()} = ${nerdamer(dxRHS).toTeX()} + C`;
                    } catch (e) {
                        console.error("Error generating homogeneous separable step LaTeX:", e);
                    }
                } else {
                    num = nerdamer(dyBydx).numerator().toString();
                    den = nerdamer(dyBydx).denominator().toString();
                    console.log(`numerator: ${num}, denominator: ${den}`);

                    // Separating variables robustly using algebraic factorization
                    let numSeparated = separateFactors(num);
                    let denSeparated = separateFactors(den);
                    let dyExpr, dxExpr;

                    if (numSeparated && denSeparated) {
                        dyExpr = nerdamer(`(${denSeparated.yPart}) / (${numSeparated.yPart})`).simplify().toString();
                        dxExpr = nerdamer(`(${numSeparated.xPart}) / (${denSeparated.xPart})`).simplify().toString();
                    } else {
                        // Fallback to robust algebraic substitution
                        dyExpr = `1/(${num})`;
                        dxExpr = `1/(${den})`;

                        const testValues = ['1', '2', '3', '5'];
                        for (let val of testValues) {
                            let num_norm = nerdamer(num).sub('x', val).sub('y', val);
                            let den_norm = nerdamer(den).sub('x', val).sub('y', val);
                            if (num_norm.toString() !== '0' && den_norm.toString() !== '0') {
                                let num_y = nerdamer(num).sub('x', val);
                                let num_x = nerdamer(num).sub('y', val);
                                let den_y = nerdamer(den).sub('x', val);
                                let den_x = nerdamer(den).sub('y', val);

                                dyExpr = nerdamer(`(${den_y})/(${num_y})`).simplify().toString();
                                dxExpr = nerdamer(`((${num_x})/(${den_x})) / ((${num_norm})/(${den_norm}))`).simplify().toString();
                                break;
                            }
                        }
                    }

                    dy = nerdamer(dyExpr).toString();
                    dx = nerdamer(dxExpr).toString();

                    console.log(`integrate(${dy}, y), integrate(${dx},x)`);
                    dyLHS = TotalIntegration(dy, 'y', replaceOrder);
                    dxRHS = TotalIntegration(dx, 'x', replaceOrder);

                    try {
                        separable_form_step = `\\text{Separable ODE form: } g(y)dy = f(x)dx`;
                        separable_sol_step = `\\text{General solution form: } \\int g(y)dy = \\int f(x)dx + C`;
                        separable_separated_step = `\\text{Separating variables: } (${nerdamer(dy).toTeX()}) dy = (${nerdamer(dx).toTeX()}) dx`;
                        separable_integration_step = `\\text{Integrating both sides: } \\int (${nerdamer(dy).toTeX()}) dy = \\int (${nerdamer(dx).toTeX()}) dx \\implies ${nerdamer(dyLHS).toTeX()} = ${nerdamer(dxRHS).toTeX()} + C`;
                    } catch (e) {
                        console.error("Error generating separable step LaTeX:", e);
                    }
                }
                console.log(`integrate(${dy}) = ${dyLHS}, integrate(${dx},x) = ${dxRHS}`);

                // Fallback to exact differential solver if separable integration failed (i.e. leaves unintegrated forms)
                if (dyLHS.includes('integrate') || dxRHS.includes('integrate')) {
                    console.log("Separable integration failed analytically. Falling back to exact ODE solver.");
                    let sol_arr = exactDifferTest(expr.replace('dy/dx', 'Y1'));
                    if (sol_arr && sol_arr !== '0' && sol_arr !== 'no \\ analytical \\ solution \\ exists') {
                        if (sol_arr.startsWith('[')) {
                            let parsed = parseExactSol(sol_arr);
                            if (parsed) {
                                sol_arr = parsed.u;
                            }
                        }
                        ode_sol = TotalIntegration(sol_arr, 'x', replaceOrder - 1);
                        return ode_sol + '=' + 'C';
                    }
                }

                if (dyLHS === 'y') {
                    // Already solved for y! No need to call nerdamer.solve which gets stuck on complex x integrations
                    ode_sol = dxRHS;
                } else {
                    ode_sol = dyLHS + '=' + dxRHS;
                    try {
                        let y = nerdamer(`solve(${ode_sol}, y)`).toString();
                        console.log(y, ode_sol);
                        y = y.replaceAll('[', '').replaceAll(']', '');
                        if (!y.includes(',') && !y == '') {
                            ode_sol = y;
                        }
                        else {
                            ode_sol = y !== '' ? y.split(',').map((item, i) => `C_${i}*(${item})`).join('+') :
                                ode_sol;
                        }
                    } catch (e) {
                        console.error("Error solving final ODE:", e);
                    }
                }
                return cleanSolveResult(ode_sol);
            }
            else {
                expr = expr.replace('dy/dx', `Y1`);
                let sol_arr = exactDifferTest(expr);
                if (sol_arr && sol_arr !== '0') {
                    if (sol_arr.startsWith('[')) {
                        let parsed = parseExactSol(sol_arr);
                        if (parsed) {
                            sol_arr = parsed.u;
                        }
                    }
                    if (nerdamer(sol_arr).simplify().toString() !== '0') {
                        ode_sol = TotalIntegration(sol_arr, 'x', replaceOrder - 1);
                        return ode_sol + '=' + 'C';
                    }
                    else {
                        return `0`;
                    }
                }
                return `0`;
            }
        });
    }
    if (partSol.length === 1 && partSol[0] === "0") {
        return "no \\ analytical \\ solution \\ exists";
    }
    let hasEquals = partSol.some(sol => sol.includes('='));
    let result_str;
    if (hasEquals) {
        result_str = partSol.join('+');
        if (!result_str.endsWith('=C') && !result_str.endsWith('= C')) {
            result_str += '+C';
        }
    } else {
        result_str = 'y' + '=' + partSol.join('+') + '+' + 'C';
    }
    if (result_str.split('=').length - 1 > 1) {
        result_str = result_str.split('=').slice(1, -1).join('+');
        result_str = nerdamer(`(-(${result_str}))`).toString();
        result_str = result_str + '=' + 'C';
    }
    return result_str;
}

function cleanTrigIdentities(str) {
    if (!str || typeof str !== 'string') return str;

    // Replace cos(u)^2 + sin(u)^2 with 1
    str = str.replace(/cos\(([^)]+)\)\^2\s*\+\s*sin\(\1\)\^2/g, '1')
        .replace(/sin\(([^)]+)\)\^2\s*\+\s*cos\(\1\)\^2/g, '1');

    // Handle cases with no spaces or parenthesis variations
    str = str.replace(/cos\(([^)]+)\)\^2\+sin\(\1\)\^2/g, '1')
        .replace(/sin\(([^)]+)\)\^2\+cos\(\1\)\^2/g, '1');

    // Replace 2*sin(u)*cos(u) with sin(2*u), protecting powers using (?!\^)
    str = str.replace(/2\*cos\(([^)]+)\)\*sin\(\1\)(?!\^)/g, 'sin(2*$1)')
        .replace(/2\*sin\(([^)]+)\)\*cos\(\1\)(?!\^)/g, 'sin(2*$1)');

    // Also handle negative versions like -2*sin(u)*cos(u)
    str = str.replace(/-2\*cos\(([^)]+)\)\*sin\(\1\)(?!\^)/g, '-sin(2*$1)')
        .replace(/-2\*sin\(([^)]+)\)\*cos\(\1\)(?!\^)/g, '-sin(2*$1)');

    return str;
}

function rewriteReciprocalTrigProducts(str) {
    if (!str || typeof str !== 'string') return str;
    let pat1 = /cos\(([^)]+)\)\^(\(-1\)|-1)\s*\*\s*sin\(\1\)\^(\(-1\)|-1)/g;
    let pat2 = /sin\(([^)]+)\)\^(\(-1\)|-1)\s*\*\s*cos\(\1\)\^(\(-1\)|-1)/g;
    let pat3 = /\(cos\(([^)]+)\)\s*\*\s*sin\(\1\)\)\^(\(-1\)|-1)/g;
    let pat4 = /\(sin\(([^)]+)\)\s*\*\s*cos\(\1\)\)\^(\(-1\)|-1)/g;
    str = str.replace(pat1, '(cot($1)+tan($1))')
        .replace(pat2, '(cot($1)+tan($1))')
        .replace(pat3, '(cot($1)+tan($1))')
        .replace(pat4, '(cot($1)+tan($1))');
    return str;
}

function rewriteHyperbolicProducts(str) {
    if (!str || typeof str !== 'string') return str;
    let pat1 = /cosh\(([^)]+)\)\^(\(-1\)|-1)\s*\*\s*sinh\(\1\)/g;
    let pat2 = /sinh\(([^)]+)\)\s*\*\s*cosh\(\1\)\^(\(-1\)|-1)/g;
    let pat3 = /cosh\(([^)]+)\)\s*\*\s*sinh\(\1\)\^(\(-1\)|-1)/g;
    let pat4 = /sinh\(([^)]+)\)\^(\(-1\)|-1)\s*\*\s*cosh\(\1\)/g;
    str = str.replace(pat3, 'coth($1)')
        .replace(pat4, 'coth($1)')
        .replace(pat2, 'tanh($1)')
        .replace(pat1, 'tanh($1)');
    return str;
}

function simplifyLogExponents(str) {
    if (!str || typeof str !== 'string') return str;

    let safe = str.replace(/\be\^\(/g, 'exp(');

    let idx = safe.indexOf('exp(');
    while (idx !== -1) {
        let bracketCount = 1;
        let j = idx + 4;
        while (j < safe.length && bracketCount > 0) {
            if (safe[j] === '(') bracketCount++;
            else if (safe[j] === ')') bracketCount--;
            j++;
        }
        if (bracketCount === 0) {
            let exponent = safe.slice(idx + 4, j - 1);
            let fullMatch = safe.slice(idx, j);
            try {
                if (exponent.includes('log')) {
                    let cleanExp = convertTrigReciprocals(exponent);
                    let terms = getTerms(cleanExp);
                    let prod = terms.map(t => 'exp(' + t + ')').join('*');
                    let simplifiedExp = nerdamer(prod).simplify().toString();
                    safe = safe.replace(fullMatch, simplifiedExp);
                    idx = safe.indexOf('exp(', idx + simplifiedExp.length);
                } else {
                    idx = safe.indexOf('exp(', idx + 1);
                }
            } catch (e) {
                idx = safe.indexOf('exp(', idx + 1);
            }
        } else {
            idx = safe.indexOf('exp(', idx + 1);
        }
    }

    return safe;
}

function directExactSolver(input, allowIF = true) {
    try {
        let lhs = input.split('=')[0].trim();
        let rhs = input.split('=')[1] ? input.split('=')[1].trim() : '0';

        // Re-arrange LHS - RHS to have everything on one side
        let eqExpr = `(${lhs}) - (${rhs})`;

        // 1. Extract P by setting Y1 = 0
        let P = nerdamer(eqExpr).sub('Y1', '0').simplify().toString();

        // 2. Extract Q by differentiating LHS wrt Y1
        let Q = nerdamer(`diff(${eqExpr}, Y1)`).simplify().toString();

        // 3. Compute partial derivatives
        let dPy = nerdamer(`diff(${P}, y)`).sub('log(const_e)', '1').simplify().toString();
        let dQx = nerdamer(`diff(${Q}, x)`).sub('log(const_e)', '1').simplify().toString();

        // Apply trig identity cleanups
        dPy = cleanTrigIdentities(dPy);
        dQx = cleanTrigIdentities(dQx);

        let equalCheck = nerdamer(dPy + '-' + dQx).sub('log(const_e)', '1').expand().simplify().toString();
        equalCheck = cleanTrigIdentities(equalCheck);
        equalCheck = nerdamer(equalCheck).sub('log(const_e)', '1').simplify().toString();

        if (equalCheck === '0') {
            try {
                exact_form_step = `\\text{Exact ODE form: } M(x,y)dx + N(x,y)dy = 0`;
                exact_sol_step = `\\text{General solution form: } u(x,y) = C \\text{ where } \\frac{\\partial u}{\\partial x} = M, \\ \\frac{\\partial u}{\\partial y} = N`;
                exact_verification_step = `M(x,y) = ${nerdamer(P).toTeX()}, \\ N(x,y) = ${nerdamer(Q).toTeX()} \\\\ \\text{Verification: } \\frac{\\partial M}{\\partial y} = \\frac{\\partial N}{\\partial x} = ${nerdamer(dPy).toTeX()}`;
            } catch (e) {
                console.error("Error generating exact step LaTeX in directExactSolver:", e);
            }
            let u = TotalIntegration(P, 'x', 1);
            let duy = nerdamer(`diff(${u}, y)`).sub('log(const_e)', '1').toString();
            u = TotalIntegration(`(${Q})-(${duy})`, 'y', 1) + '+' + '(' + u + ')';
            u = nerdamer(u).sub('log(const_e)', '1').simplify().toString();
            u = cleanSolveResult(u);
            return u;
        }

        if (!allowIF) {
            return '0';
        }

        // 4. Check for integrating factor wrt x
        try {
            let R = nerdamer(`((${dPy})-(${dQx})) / (${Q})`).sub('log(const_e)', '1').simplify().toString();
            R = cleanTrigIdentities(R);
            R = rewriteReciprocalTrigProducts(R);
            R = rewriteHyperbolicProducts(R);
            R = nerdamer(R).sub('log(const_e)', '1').simplify().toString();
            R = rewriteReciprocalTrigProducts(R); // Run again on simplified form to catch newly simplified reciprocal trig products
            R = rewriteHyperbolicProducts(R);

            if (!R.includes('y')) {
                let IF = nerdamer(`integrate(${R}, x)`).sub('log(const_e)', '1').toString();
                IF = nerdamer(`exp(${IF})`).sub('log(const_e)', '1').expand().simplify().toString();
                IF = IF.replace(/\be\b/g, 'const_e');
                IF = convertTrigReciprocals(IF);
                IF = simplifyLogExponents(IF);
                IF = nerdamer(IF).sub('log(const_e)', '1').simplify().toString();

                let M = nerdamer(P).multiply(IF).sub('log(const_e)', '1').simplify().toString();
                let N = nerdamer(Q).multiply(IF).sub('log(const_e)', '1').simplify().toString();
                let u = TotalIntegration(M, 'x', 1);
                let duy = nerdamer(`diff(${u}, y)`).sub('log(const_e)', '1').toString();
                u = TotalIntegration(`(${N})-(${duy})`, 'y', 1) + '+' + '(' + u + ')';
                u = nerdamer(u).sub('log(const_e)', '1').simplify().toString();
                u = cleanSolveResult(u);

                try {
                    exact_form_step = `\\text{Exact ODE form: } M(x,y)dx + N(x,y)dy = 0`;
                    exact_sol_step = `\\text{General solution form: } u(x,y) = C \\text{ where } \\frac{\\partial u}{\\partial x} = M, \\ \\frac{\\partial u}{\\partial y} = N`;
                    exact_M_N_step = `\\text{Non-exact ODE: finding Integrating Factor (wrt x)}`;
                    exact_verification_step = `M(x,y) = ${nerdamer(P).toTeX()}, \\ N(x,y) = ${nerdamer(Q).toTeX()}`;
                    exact_u_step = `\\text{Integrating Factor (wrt x): } I(x) = e^{\\int \\frac{M_y - N_x}{N} dx} = ${nerdamer(IF).toTeX()}`;
                } catch (e) {
                    console.error("Error generating exact IF wrt x step LaTeX in directExactSolver:", e);
                }

                return `[${IF}, ${u}]`;
            }
        } catch (e) {
            console.log("Integrating factor wrt x failed:", e);
        }

        // 5. Check for integrating factor wrt y
        try {
            let RStar = nerdamer(`((${dQx})-(${dPy})) / (${P})`).sub('log(const_e)', '1').simplify().toString();
            RStar = cleanTrigIdentities(RStar);
            RStar = rewriteReciprocalTrigProducts(RStar);
            RStar = rewriteHyperbolicProducts(RStar);
            RStar = nerdamer(RStar).sub('log(const_e)', '1').simplify().toString();
            RStar = rewriteReciprocalTrigProducts(RStar); // Run again on simplified form to catch newly simplified reciprocal trig products
            RStar = rewriteHyperbolicProducts(RStar);

            if (!RStar.includes('x')) {
                let IF = nerdamer(`integrate(${RStar}, y)`).sub('log(const_e)', '1').toString();
                IF = nerdamer(`exp(${IF})`).sub('log(const_e)', '1').expand().simplify().toString();
                IF = IF.replace(/\be\b/g, 'const_e');
                IF = convertTrigReciprocals(IF);
                IF = simplifyLogExponents(IF);
                IF = nerdamer(IF).sub('log(const_e)', '1').simplify().toString();

                let M = nerdamer(P).multiply(IF).sub('log(const_e)', '1').simplify().toString();
                let N = nerdamer(Q).multiply(IF).sub('log(const_e)', '1').simplify().toString();
                let u = TotalIntegration(M, 'x', 1);
                let duy = nerdamer(`diff(${u}, y)`).sub('log(const_e)', '1').toString();
                u = TotalIntegration(`(${N})-(${duy})`, 'y', 1) + '+' + '(' + u + ')';
                u = nerdamer(u).sub('log(const_e)', '1').simplify().toString();
                u = cleanSolveResult(u);

                try {
                    exact_form_step = `\\text{Exact ODE form: } M(x,y)dx + N(x,y)dy = 0`;
                    exact_sol_step = `\\text{General solution form: } u(x,y) = C \\text{ where } \\frac{\\partial u}{\\partial x} = M, \\ \\frac{\\partial u}{\\partial y} = N`;
                    exact_M_N_step = `\\text{Non-exact ODE: finding Integrating Factor (wrt y)}`;
                    exact_verification_step = `M(x,y) = ${nerdamer(P).toTeX()}, \\ N(x,y) = ${nerdamer(Q).toTeX()}`;
                    exact_u_step = `\\text{Integrating Factor (wrt y): } I(y) = e^{\\int \\frac{N_x - M_y}{M} dy} = ${nerdamer(IF).toTeX()}`;
                } catch (e) {
                    console.error("Error generating exact IF wrt y step LaTeX in directExactSolver:", e);
                }

                return `[${IF}, ${u}]`;
            }
        } catch (e) {
            console.log("Integrating factor wrt y failed:", e);
        }

        return '0';
    } catch (e) {
        return '0';
    }
}

function exactDifferTest(input) {
    console.log(`exactDifferTest(${input})`);

    // Attempt direct exact/integrating-factor solver first
    let direct_sol = directExactSolver(input);
    if (direct_sol && direct_sol !== '0') {
        return direct_sol;
    }

    let problem = solveLinearY(input, 'Y1');
    if (!problem) {
        problem = nerdamer(`solve(${input}, Y1)`).toString();
        problem = problem.replaceAll('[', '').replaceAll(']', '');
    }
    let M, N, factors, dMy, dNx, sol, u;
    let partSol = problem.split(',');
    console.log(`The solution for dy/dx = ${problem}`);
    partSol = partSol.map(item => {
        item = nerdamer(item).toString();
        let factorize = nerdamer(item).toString();
        let num = nerdamer(factorize).numerator().toString();
        let den = nerdamer(factorize).denominator().toString();

        num = nerdamer(num).simplify().toString();
        den = nerdamer(den).simplify().toString();

        console.log(`In ${input}: Numerator:${num}, Denominator:${den}`);
        if (!/[xy]/.test(den)) {
            factors = splitProductTerm(num);
            N = nerdamer(`(${den}) / (${factors[0]})`).simplify().toString();
            M = nerdamer(`0-((${num}) / (${factors[0]}))`).simplify().toString();
            dMy = nerdamer(`diff(${M}, y)`).simplify().toString();
            dNx = nerdamer(`diff(${N}, x)`).simplify().toString();
            let equalCheck = nerdamer(dMy - dNx).expand().simplify().toString();
            console.log(`${input} => M(x,y):[${M}] + N(x,y):[${N}]*dy/dx = 0`);
            console.log(`dM/dy:[${dMy}] - dN/dx:[{${dNx}] = ${equalCheck}`);
            if (equalCheck == '0') {
                try {
                    exact_form_step = `\\text{Exact ODE form: } M(x,y)dx + N(x,y)dy = 0`;
                    exact_sol_step = `\\text{General solution form: } u(x,y) = C \\text{ where } \\frac{\\partial u}{\\partial x} = M, \\ \\frac{\\partial u}{\\partial y} = N`;
                    exact_verification_step = `M(x,y) = ${nerdamer(M).toTeX()}, \\ N(x,y) = ${nerdamer(N).toTeX()} \\\\ \\text{Verification: } \\frac{\\partial M}{\\partial y} = \\frac{\\partial N}{\\partial x} = ${nerdamer(dMy).toTeX()}`;
                } catch (e) {
                    console.error("Error generating exact step LaTeX:", e);
                }
                let u = TotalIntegration(M, 'x', 1);
                let duy = nerdamer(`diff(${u}, y)`).toString();
                u = TotalIntegration(`(${N})-(${duy})`, 'y', 1) + '+' + '(' + u + ')';
                sol = nerdamer(u).simplify().toString();
                sol = cleanSolveResult(sol);
                console.log(`The solution of excat differential ${input}: ${sol}`);
                return sol;
            }
            else {
                return reduceToExactDiff(M, N, dMy, dNx);
            }
        }
        else if (!/[xy]/.test(num)) {
            factors = splitProductTerm(den);
            N = nerdamer(`(${den}) / (${factors[0]})`).simplify().toString();
            M = nerdamer(`0-((${num}) / (${factors[0]}))`).simplify().toString();
            dMy = nerdamer(`diff(${M}, y)`).simplify().toString();
            dNx = nerdamer(`diff(${N}, x)`).simplify().toString();
            let equalCheck = nerdamer(dMy - dNx).expand().simplify().toString();
            console.log(`${input} => M(x,y):[${M}] + N(x,y):[${N}]*dy/dx = 0`);
            console.log(`dM/dy:[${dMy}] - dN/dx:[{${dNx}] = ${equalCheck}`);
            if (equalCheck == '0') {
                try {
                    exact_form_step = `\\text{Exact ODE form: } M(x,y)dx + N(x,y)dy = 0`;
                    exact_sol_step = `\\text{General solution form: } u(x,y) = C \\text{ where } \\frac{\\partial u}{\\partial x} = M, \\ \\frac{\\partial u}{\\partial y} = N`;
                    exact_verification_step = `M(x,y) = ${nerdamer(M).toTeX()}, \\ N(x,y) = ${nerdamer(N).toTeX()} \\\\ \\text{Verification: } \\frac{\\partial M}{\\partial y} = \\frac{\\partial N}{\\partial x} = ${nerdamer(dMy).toTeX()}`;
                } catch (e) {
                    console.error("Error generating exact step LaTeX:", e);
                }
                let u = TotalIntegration(M, 'x', 1);
                let duy = nerdamer(`diff(${u}, y)`).toString();
                u = TotalIntegration(`(${N})-(${duy})`, 'y', 1) + '+' + '(' + u + ')';
                sol = nerdamer(u).simplify().toString();
                sol = cleanSolveResult(sol);
                console.log(`The solution of excat differential ${input}: ${sol}`);
                return sol;
            }
            else {
                return reduceToExactDiff(M, N, dMy, dNx);
            }
        }
        else {
            N = den;
            M = nerdamer(`0-(${num})`).toString();
            dMy = nerdamer(`diff(${M}, y)`).simplify().toString();
            dNx = nerdamer(`diff(${N}, x)`).simplify().toString();
            let equalCheck = nerdamer(dMy).toString() == nerdamer(dNx).toString() ? 0 : 1;
            console.log(`${input} => M(x,y):[${M}] + N(x,y):[${N}]*dy/dx = 0`);
            console.log(`dM/dy:[${dMy}] - dN/dx:[${dNx}] = ${equalCheck}`);
            if (equalCheck == 0) {
                try {
                    exact_form_step = `\\text{Exact ODE form: } M(x,y)dx + N(x,y)dy = 0`;
                    exact_sol_step = `\\text{General solution form: } u(x,y) = C \\text{ where } \\frac{\\partial u}{\\partial x} = M, \\ \\frac{\\partial u}{\\partial y} = N`;
                    exact_verification_step = `M(x,y) = ${nerdamer(M).toTeX()}, \\ N(x,y) = ${nerdamer(N).toTeX()} \\\\ \\text{Verification: } \\frac{\\partial M}{\\partial y} = \\frac{\\partial N}{\\partial x} = ${nerdamer(dMy).toTeX()}`;
                } catch (e) {
                    console.error("Error generating exact step LaTeX:", e);
                }
                let u = TotalIntegration(M, 'x', 1);
                let duy = nerdamer(`diff(${u}, y)`).toString();
                u = TotalIntegration(`(${N})-(${duy})`, 'y', 1) + '+' + '(' + u + ')';
                sol = nerdamer(u).simplify().toString();
                sol = cleanSolveResult(sol);
                console.log(`The solution of exact differential ${input}: ${sol}`);
                return sol;
            }
            else {
                return reduceToExactDiff(M, N, dMy, dNx);
            }
        }
    });
    console.log(partSol);
    let finSol = partSol.join('+');
    console.log(finSol);
    return finSol;
}

function reduceToExactDiff(P, Q, dPy, dQx) {
    console.log(`reduce to exact : P:${P}, Q:${Q}, dP/dy:${dPy}, dQ/dx:${dQx} `);
    P = nerdamer(P).sub('log(const_e)', '1').simplify().toString();
    Q = nerdamer(Q).sub('log(const_e)', '1').simplify().toString();

    // 1. Check if R(x) = (dPy - dQx) / Q is a function of x only
    let R = nerdamer(`((${dPy})-(${dQx})) / (${Q})`).sub('log(const_e)', '1').simplify().toString();
    R = cleanTrigIdentities(R);
    R = rewriteReciprocalTrigProducts(R);
    R = rewriteHyperbolicProducts(R);
    R = nerdamer(R).sub('log(const_e)', '1').simplify().toString();
    R = rewriteReciprocalTrigProducts(R); // Run again on simplified form to catch newly simplified reciprocal trig products
    R = rewriteHyperbolicProducts(R);
    console.log(`R(x): ${R}`);

    if (!R.includes('y')) {
        let IF = nerdamer(`integrate(${R}, x)`).sub('log(const_e)', '1').toString();
        IF = nerdamer(`exp(${IF})`).sub('log(const_e)', '1').expand().simplify().toString();
        IF = IF.replace(/\be\b/g, 'const_e');
        IF = convertTrigReciprocals(IF);
        IF = simplifyLogExponents(IF);
        IF = nerdamer(IF).sub('log(const_e)', '1').simplify().toString();
        console.log(`I.F. (wrt x): ${IF}`);

        let M = nerdamer(P).multiply(IF).sub('log(const_e)', '1').simplify().toString();
        let N = nerdamer(Q).multiply(IF).sub('log(const_e)', '1').simplify().toString();
        let u = TotalIntegration(M, 'x', 1);
        let duy = nerdamer(`diff(${u}, y)`).sub('log(const_e)', '1').toString();
        u = TotalIntegration(`(${N})-(${duy})`, 'y', 1) + '+' + '(' + u + ')';
        u = nerdamer(u).sub('log(const_e)', '1').simplify().toString();
        u = cleanSolveResult(u);

        try {
            exact_form_step = `\\text{Exact ODE form: } M(x,y)dx + N(x,y)dy = 0`;
            exact_sol_step = `\\text{General solution form: } u(x,y) = C \\text{ where } \\frac{\\partial u}{\\partial x} = M, \\ \\frac{\\partial u}{\\partial y} = N`;
            exact_M_N_step = `\\text{Non-exact ODE: finding Integrating Factor (wrt x)}`;
            exact_verification_step = `M(x,y) = ${nerdamer(P).toTeX()}, \\ N(x,y) = ${nerdamer(Q).toTeX()}`;
            exact_u_step = `\\text{Integrating Factor (wrt x): } I(x) = e^{\\int \\frac{M_y - N_x}{N} dx} = ${nerdamer(IF).toTeX()}`;
        } catch (e) {
            console.error("Error generating exact IF wrt x step LaTeX:", e);
        }

        return `[${IF}, ${u}]`;
    }

    // 2. Check if R*(y) = (dQx - dPy) / P is a function of y only
    let RStar = nerdamer(`((${dQx})-(${dPy})) / (${P})`).sub('log(const_e)', '1').simplify().toString();
    RStar = cleanTrigIdentities(RStar);
    RStar = rewriteReciprocalTrigProducts(RStar);
    RStar = rewriteHyperbolicProducts(RStar);
    RStar = nerdamer(RStar).sub('log(const_e)', '1').simplify().toString();
    RStar = rewriteReciprocalTrigProducts(RStar); // Run again on simplified form to catch newly simplified reciprocal trig products
    RStar = rewriteHyperbolicProducts(RStar);
    console.log(`R*(y): ${RStar}`);

    if (!RStar.includes('x')) {
        let IF = nerdamer(`integrate(${RStar}, y)`).sub('log(const_e)', '1').toString();
        IF = nerdamer(`exp(${IF})`).sub('log(const_e)', '1').expand().simplify().toString();
        IF = IF.replace(/\be\b/g, 'const_e');
        IF = convertTrigReciprocals(IF);
        IF = simplifyLogExponents(IF);
        IF = nerdamer(IF).sub('log(const_e)', '1').simplify().toString();
        console.log(`I.F. (wrt y): ${IF}`);

        let M = nerdamer(P).multiply(IF).sub('log(const_e)', '1').simplify().toString();
        let N = nerdamer(Q).multiply(IF).sub('log(const_e)', '1').simplify().toString();
        let u = TotalIntegration(M, 'x', 1);
        let duy = nerdamer(`diff(${u}, y)`).sub('log(const_e)', '1').toString();
        u = TotalIntegration(`(${N})-(${duy})`, 'y', 1) + '+' + '(' + u + ')';
        u = nerdamer(u).sub('log(const_e)', '1').simplify().toString();
        u = cleanSolveResult(u);

        try {
            exact_form_step = `\\text{Exact ODE form: } M(x,y)dx + N(x,y)dy = 0`;
            exact_sol_step = `\\text{General solution form: } u(x,y) = C \\text{ where } \\frac{\\partial u}{\\partial x} = M, \\ \\frac{\\partial u}{\\partial y} = N`;
            exact_M_N_step = `\\text{Non-exact ODE: finding Integrating Factor (wrt y)}`;
            exact_verification_step = `M(x,y) = ${nerdamer(P).toTeX()}, \\ N(x,y) = ${nerdamer(Q).toTeX()}`;
            exact_u_step = `\\text{Integrating Factor (wrt y): } I(y) = e^{\\int \\frac{N_x - M_y}{M} dy} = ${nerdamer(IF).toTeX()}`;
        } catch (e) {
            console.error("Error generating exact IF wrt y step LaTeX:", e);
        }

        return `[${IF}, ${u}]`;
    }

    // 3. No single-variable integrating factor exists
    console.log("No single-variable integrating factor exists.");
    return '0';
}

function linearODEsolver(input, allowIntegrate = false) {
    try {
        let eq = input.split('=').join('-(') + ')';
        eq = convertTrigReciprocals(eq);
        let eqExpr = nerdamer(eq).simplify().toString();
        console.log(`input: ${eqExpr}`);

        // Check linearity by differentiating twice and checking cross-derivatives
        let d2_Y1 = nerdamer(`diff(diff(${eqExpr}, Y1), Y1)`).simplify().toString();
        let d2_y = nerdamer(`diff(diff(${eqExpr}, y), y)`).simplify().toString();
        let d_cross = nerdamer(`diff(diff(${eqExpr}, Y1), y)`).simplify().toString();

        console.log(`d2_Y1: ${d2_Y1}, d2_y: ${d2_y}, d_cross: ${d_cross}`);

        if (d2_Y1 === '0' && d2_y === '0' && d_cross === '0') {
            let Y1 = nerdamer(`solve(${eqExpr}, Y1)`).toString().replaceAll('[', '').replaceAll(']', '');
            let Q = nerdamer(Y1).sub('y', '0').simplify().toString();
            let P = nerdamer(`diff(${Y1}, y)`).multiply('-1').simplify().toString();

            let h = nerdamer(`integrate(${P}, x)`).simplify().toString();
            let IF = nerdamer(`exp(${h})`).simplify().toString();
            let IF_inv = nerdamer(`exp(-(${h}))`).simplify().toString();
            let integral = nerdamer(`integrate((${Q}) * (${IF}), x)`).simplify().toString();

            let particular = nerdamer(`(${integral}) * (${IF_inv})`).expand().simplify().toString().replace(/\be\b/g, 'const_e');
            let transient = nerdamer(`const_C * (${IF_inv})`).simplify().toString().replace(/\be\b/g, 'const_e');
            let sol = particular + ' + ' + transient;
            sol = sol.replace(/\bconst_C\b/g, 'C');
            sol = cleanSolveResult(sol);

            if (sol === '0' || (!allowIntegrate && sol.includes('integrate'))) {
                console.log("Linear ODE integration failed analytically, returning '0' for fallback.");
                return '0';
            }

            try {
                linear_P_step = `\\text{First-order Linear ODE form: } y' + P(x)y = Q(x) \\\\ P(x) = ${nerdamer(P).toTeX()}`;
                linear_Q_step = `Q(x) = ${nerdamer(Q).toTeX()}`;
                linear_IF_step = `\\text{Integrating Factor: } I(x) = e^{\\int P(x)dx} = ${nerdamer(IF.replace(/\bconst_e\b/g, 'e')).toTeX()}`;
                linear_integ_step = `\\text{General solution form: } y = \\frac{1}{I(x)} \\left( \\int Q(x) I(x) dx + C \\right) \\\\ \\text{General Solution Integral: } \\int Q(x)I(x)dx = ${nerdamer(integral.replace(/\bconst_e\b/g, 'e')).toTeX()}`;
            } catch (e) {
                console.error("Error generating linear ODE step LaTeX:", e);
            }

            return `y = ${sol}`;
        } else {
            console.log(`Non linear ODE, trying to reduce ${eqExpr} to linear ODE`);
            if (d2_Y1 === '0' && d2_y !== '0' && d_cross === '0') {
                let sol = reduceToLinear(input);
                return sol;
            } else {
                console.log(`Strictly Non linear ODE, return '0'`);
                return '0';
            }
        }
    } catch (e) {
        console.error("Error in linearODEsolver:", e);
        return '0';
    }
}

function reduceToLinear(problem) {
    try {
        let eq = problem.split('=').join('-(') + ')';
        eq = convertTrigReciprocals(eq);
        let eqExpr = nerdamer(eq).simplify().toString();

        let Y1 = nerdamer(`solve(${eqExpr}, Y1)`).toString().replaceAll('[', '').replaceAll(']', '');
        let allterms = getTerms(Y1);
        if (allterms.length !== 2) {
            console.log("Not reducible to linear: Y1 must have exactly 2 terms");
            return '0';
        }

        let term1 = allterms[0];
        let term2 = allterms[1];

        let exp1 = nerdamer(`(y * diff(${term1}, y)) / (${term1})`).simplify().toString();
        let exp2 = nerdamer(`(y * diff(${term2}, y)) / (${term2})`).simplify().toString();

        let linearTerm = null;
        let bernoulliTerm = null;
        let n = null;

        if (exp1 === '1' && exp2 !== '1' && exp2 !== '0') {
            linearTerm = term1;
            bernoulliTerm = term2;
            n = exp2;
        } else if (exp2 === '1' && exp1 !== '1' && exp1 !== '0') {
            linearTerm = term2;
            bernoulliTerm = term1;
            n = exp1;
        } else {
            console.log(`Not reducible to linear: expected one term of degree 1 and another of degree n (where n != 0, 1) in y. Got degrees ${exp1} and ${exp2}`);
            return '0';
        }

        let P = nerdamer(linearTerm).divide('y').multiply('-1').simplify().toString();
        let Q = nerdamer(bernoulliTerm).divide(`y^(${n})`).simplify().toString();

        let one_minus_n = nerdamer(`1 - (${n})`).simplify().toString();
        let P_new = nerdamer(`(${one_minus_n}) * (${P})`).simplify().toString();
        let Q_new = nerdamer(`(${one_minus_n}) * (${Q})`).simplify().toString();

        let linearProblem = `Y1 + (${P_new})*y = ${Q_new}`;
        console.log(`Transformed linear problem: ${linearProblem}`);

        try {
            bernoulli_sub_step = `\\text{Bernoulli ODE form: } y' + P(x)y = Q(x)y^n \\\\ \\text{Bernoulli ODE: substitution } v = y^{1-n} = y^{${nerdamer(one_minus_n).toTeX()}}`;
            bernoulli_linear_step = `\\text{General solution form: } v = y^{1-n} \\implies v' + (1-n)P(x)v = (1-n)Q(x) \\\\ \\text{Reduces to Linear ODE: } \\frac{dv}{dx} + (${nerdamer(P_new).toTeX()}) v = ${nerdamer(Q_new).toTeX()}`;
        } catch (e) {
            console.error("Error generating Bernoulli step LaTeX:", e);
        }

        let sol = linearODEsolver(linearProblem, true);
        if (sol === '0') {
            return '0';
        }

        let rhs = sol.replace(/^y\s*=\s*/, '');
        return `y^(${one_minus_n}) = ${rhs}`;
    } catch (e) {
        console.error("Error in reduceToLinear:", e);
        return '0';
    }
}

function splitProductTerm(term) {
    let depth = 0;
    const factors = [];
    let start = 0;

    for (let i = 0; i <= term.length; i++) {
        if (i < term.length) {
            if (term[i] === '(') depth++;
            else if (term[i] === ')') depth--;
        }

        if ((term[i] === '*' && depth === 0) || i === term.length) {
            factors.push(term.slice(start, i));
            start = i + 1;
        }
    }

    if (factors.length === 1) return ['1', term];

    const plain = factors.filter(f => !f.includes('('));
    const funcs = factors.filter(f => f.includes('('));

    const isConstant = f => /^-?\d+(\.\d+)?$/.test(f);
    const vars = plain.filter(f => !isConstant(f));
    const constants = plain.filter(f => isConstant(f));

    let left, right;

    if (funcs.length === 0) {
        const last = factors[factors.length - 1];
        left = factors.slice(0, -1).join('*');
        right = last;
    } else if (vars.length > 0) {
        left = [...constants, ...vars].join('*');
        right = funcs.join('*');
    } else {
        const mid = Math.ceil(funcs.length / 2);
        left = funcs.slice(0, mid).join('*');
        right = funcs.slice(mid).join('*');
    }

    if (left.split('*').every(isConstant)) left = '1';

    return [left, right];
}

//Change to Nerdamer Form
function nerdamerTest(test_inp) {

    let test = test_inp;

    console.log(`nerdamerTest(${test}) was called`);

    test = test.replaceAll('d^1y', 'dy').replaceAll('dx^1', 'dx');
    test = test.replaceAll('dx', '(dx)').replaceAll('xy', 'x*y');
    console.log(`test input converted to ${test}`);

    let testArr = test.split('=');

    let rightHand = nerdamer(testArr[1]).toString();
    let leftHand = nerdamer(testArr[0]).toString();

    console.log(`LHS parsed to ${leftHand} \n RHS parsed to ${rightHand}`);

    test = leftHand + '=' + rightHand;
    console.log(`Final parsed expression : ${test}`);

    let solved_dy = solveLinearY(test, 'dy');
    if (!solved_dy) {
        test = nerdamer(`solve(${test}, dy)`).toString();
        test = test.replaceAll('[', '').replaceAll(']', '');
    } else {
        test = solved_dy;
    }
    console.log(`The expression was solved for dy : dy = ${test}`);

    // Keep clean unsolved expression to avoid factor() decimal-bloating when passing to factorOutx
    let solvedExpr = test.replaceAll('dx', '1');

    test = nerdamer(`factor(${test})`).toString();
    console.log(`Expression was factored => dy = ${test}`);
    test = test.replaceAll('dx', '1');
    console.log(`dx was moved left : dy/dx = ${test}`);

    if (seperableDiff(test)) {
        console.log('It is seperable');
        tobeInteg = test;
        return true;
    }
    else {
        let nerdXbyY = nerdamer(`x/y`).toString();
        let nerdYbyX = nerdamer('y/x').toString();

        // Pass the clean original solved expression instead of the bloated factored one!
        test = factorOutx(solvedExpr);
        test = test + '-' + 'u';
        console.log(`Substituted u = y/x : dy/dx =  ${test}`);
        if (reduceToSeperable(test)) {
            console.log('It is seperable');
            tobeInteg = test;
            return true;
        }
        else {
            console.log("Not seperable");
            return false;
        }
    }
}

//Serperable Test
function seperableDiff(diffop) {
    console.log(`Checking for seperability: seperableDiff(${diffop})`);
    try {
        let numer = nerdamer(diffop).numerator().toString();
        let denom = nerdamer(diffop).denominator().toString();

        if (numer === '0' || denom === '0') return false;

        let numSeparated = separateFactors(numer);
        let denSeparated = separateFactors(denom);

        return numSeparated !== null && denSeparated !== null;
    } catch (e) {
        console.error("Error in seperableDiff:", e);
        return false;
    }
}

function factorOutx(unfact) {

    try {
        let expr = nerdamer(unfact);
        let num = expr.numerator();
        let den = expr.denominator();

        // Substitute y with (u * x) and expand/simplify to distribute powers correctly
        let numSub = num.sub('y', '(u * x)').expand().simplify();
        let denSub = den.sub('y', '(u * x)').expand().simplify();

        // Divide the simplified numerator by the simplified denominator and simplify the whole fraction
        let result = nerdamer('(' + numSub.toString() + ')/(' + denSub.toString() + ')').simplify();

        return result.toString();
    } catch (e) {
        console.error("Error in factorOutx:", e);
        return unfact;
    }
}

//Reduction to Seperable form
function reduceToSeperable(differOp) {

    console.log(`Reduction to seperable equation check: reduceToSeperable(${differOp})`);

    let isSeperable;

    let numer = nerdamer(differOp).numerator().toString();
    let denom = nerdamer(differOp).denominator().toString();
    console.log(`Numerator : ${numer} \n Denominator : ${denom}`);

    if (numer == '0' || denom == '0') {
        console.log('Either numerator or denominator is empty');
        isSeperable = false;
        return isSeperable;
    }

    let numTest = numer.includes('u') && numer.includes('x') ? false :
        numer.includes('u') && !numer.includes('x') || !numer.includes('u') && nerdamer(differOp).toString().includes('x') ||
            !numer.includes('u') && !nerdamer(differOp).toString().includes('x') ? true : false;

    let cleanNumer = numer.replace(/^[+-]/, '');
    if (numTest == false && !/[+-]/.test(cleanNumer)) {
        numTest = true;
    }

    console.log(`Numerator test : ${numTest}`);

    let denomTest = denom.includes('u') && denom.includes('x') ? false :
        denom.includes('u') && !denom.includes('x') || !denom.includes('u') && denom.includes('x') ||
            !denom.includes('u') && !denom.includes('x') ? true : false;

    let cleanDenom = denom.replace(/^[+-]/, '');
    if (denomTest == false && !/[+-]/.test(cleanDenom)) {
        denomTest = true;
    }

    console.log(`Denominator test : ${denomTest}`);

    isSeperable = numTest && denomTest ? true : false;

    return isSeperable;
}

function convToNerdamer(origEq) {

    console.log(`Converting to nerdamer diff to make initial differentiation : convToNerdamer(${origEq})`);

    let findOrder = origEq.split('d^').slice(1);
    findOrder = findOrder.map(item => parseInt(item)).filter(item => item !== isNaN(item) && item !== '');
    findOrder = [...new Set(findOrder)];
    console.log(`The available order : ${findOrder}`);

    for (let eachOrder of findOrder) {

        let y_arg = origEq;
        y_arg = y_arg.split(`d^${eachOrder}`).slice(1).join('');
        y_arg = y_arg.slice(0, y_arg.indexOf('/'));
        console.log(`Argument of differentiation [y_arg] @ order => ${eachOrder}: ${y_arg}`);
        if (y_arg != 'y' && y_arg != '(y)') {
            origEq = origEq.replaceAll(`d^${eachOrder}${y_arg}/dx^${eachOrder}`, `diff(${y_arg}, y, ${eachOrder})`);
        }
        console.log(origEq);
    }
    console.log(`The nerdamer differentiable string : ${origEq}`);
    return origEq;
}

function nerdDifferentiate(unsolved) {

    console.log(`nerdDifferentiate(${unsolved}) called`);

    let solvedDeq = unsolved;
    let solvedNerd;

    let findDiff = [];
    let idx = unsolved.indexOf('diff(');
    while (idx !== -1) {
        let bracketCount = 1;
        let j = idx + 5;
        while (j < unsolved.length && bracketCount > 0) {
            if (unsolved[j] === '(') {
                bracketCount++;
            } else if (unsolved[j] === ')') {
                bracketCount--;
            }
            j++;
        }
        if (bracketCount === 0) {
            findDiff.push(unsolved.slice(idx, j));
        }
        idx = unsolved.indexOf('diff(', idx + 1);
    }

    console.log(`Found diff expressions : ${findDiff}`);

    //Applying Chain Rule
    for (let eachDiff of findDiff) {
        let func = eachDiff.replaceAll('diff', '');
        func = func.slice(1, -1).split(',');
        console.log(`Each variable inside ${eachDiff} : ${func}`);
        let ord = func[2];
        let fxy = func[0];
        let solveProd = productRule(fxy, ord);
        console.log(`product applied for ${fxy} @ order:${ord} : ${solveProd}`);
        let nerdSolve = nerdamer(solveProd).toString();
        console.log(`${solveProd} solved using nerdamer : ${nerdSolve}`);
        solvedDeq = solvedDeq.replaceAll(eachDiff, nerdSolve);
    }
    console.log(`Final Nerdamer string after solving differential : ${solvedDeq}`);
    return solvedDeq;
}

function totalDerivative(expr) {
    console.log(`Differentiating: ${expr}`);
    let parsedExpr = nerdamer(expr);

    // 1. Partial derivative wrt x
    let dF_dx = nerdamer(`diff(${expr}, x)`);
    console.log(`Partial wrt x: d/dx(${expr}) = ${dF_dx.toString()}`);

    // 2. Partial derivative wrt y
    let dF_dy = nerdamer(`diff(${expr}, y)`);
    console.log(`Partial wrt y: d/dy(${expr}) * Y1 = (${dF_dy.toString()}) * Y1`);

    let totalStr = `(${dF_dx.toString()}) + (${dF_dy.toString()}) * (Y1)`;

    // 3. Find all Y_k variables in the expression
    let vars = parsedExpr.variables();
    for (let v of vars) {
        let match = v.match(/^Y(\d+)$/);
        if (match) {
            let k = parseInt(match[1]);
            let dF_dYk = nerdamer(`diff(${expr}, ${v})`);
            console.log(`  Partial wrt ${v}: d/d${v}(${expr}) * Y${k + 1} = (${dF_dYk.toString()}) * Y${k + 1}`);
            totalStr += ` + (${dF_dYk.toString()}) * (Y${k + 1})`;
        }
    }

    let result = nerdamer(totalStr).expand().toString();
    console.log(`  => Total Derivative: ${result}`);
    return result;
}

function productRule(uvString, order) {
    console.log(`Differentiating "${uvString}" to Order ${order}`);
    let current = uvString;
    order = parseInt(order);
    for (let i = 1; i <= order; i++) {
        console.log(`Order ${i}`);
        current = totalDerivative(current);
    }
    console.log(`Final Expanded Result: ${current}`);
    return current;
}

function getInnerFuncts(func) {
    const results = [func];

    for (let i = 0; i < func.length; i++) {
        if (func[i] === '(') {
            let depth = 1;
            let start = i + 1;
            let j = i + 1;

            while (j < func.length && depth > 0) {
                if (func[j] === '(') depth++;
                if (func[j] === ')') depth--;
                j++;
            }

            const inner = func.slice(start, j - 1);
            if (inner.includes('(')) results.push(inner);
            i = j - 1;
        }
    }
    return results;
}

function getOperators(expression) {
    const expr = expression.replace(/\s+/g, '');
    const operators = [];

    for (let i = 0; i < expr.length; i++) {
        const ch = expr[i];
        if ((ch === '+' || ch === '-') && i !== 0) {
            const prev = expr[i - 1];
            // Only a binary operator if it follows a digit, variable, or closing paren
            if (/[\d a-zA-Z)]/.test(prev)) {
                operators.push(ch);
            }
        }
    }

    return operators;
}

function getTerms(expression) {
    if (!expression || typeof expression !== 'string' || !expression.trim()) {
        return [];
    }

    // 1. Solve and fully expand the expression using Nerdamer
    // This resolves parentheses, multiplication of terms, etc.
    const solvedExpr = nerdamer(expression).expand();
    const solvedStr = solvedExpr.toString();

    // 2. Parse and split terms at the top-level (respecting brackets/parentheses)
    const terms = [];
    let currentTerm = "";
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;

    for (let i = 0; i < solvedStr.length; i++) {
        const char = solvedStr[i];

        // Track parentheses/bracket/brace levels
        if (char === '(') parenDepth++;
        else if (char === ')') parenDepth--;
        else if (char === '[') bracketDepth++;
        else if (char === ']') bracketDepth--;
        else if (char === '{') braceDepth++;
        else if (char === '}') braceDepth--;

        // Split on top-level '+' or '-' only
        if ((char === '+' || char === '-') && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
            if (currentTerm.trim()) {
                terms.push(currentTerm.trim());
            }
            // Keep the minus sign with the next term; positive terms are implicitly unsigned
            currentTerm = (char === '-') ? '-' : '';
        } else {
            currentTerm += char;
        }
    }

    if (currentTerm.trim()) {
        terms.push(currentTerm.trim());
    }

    return terms;
}

function clearSolution() {
    if (typeof document === 'undefined') return;
    // Clear the cached solution so the overlay doesn't keep showing it
    if (typeof window !== 'undefined') {
        window.mathSolverLastSolution = '';
        window._mathSolveJustRan = false;
    }
    let ode = document.getElementById("ode");
    if (ode) {
        ode.value = '';
        ode.style.width = '400px';
        ode.style.height = '60px';
    }
    let math = document.getElementById("math");
    if (math) {
        math.value = '';
        math.style.width = '400px';
        math.style.height = '60px';
        // Also reset the container so width doesn't carry over from previous input
        const container = math.closest('.ode-input-container');
        if (container) container.style.width = '400px';
    }
    let overlay = document.getElementById("ode-math-overlay");
    if (overlay) {
        overlay.style.width = '396px';
        overlay.style.height = '56px';
        overlay.innerHTML = '';
    }
    let solution = document.getElementById("solution");
    if (solution) {
        solution.innerHTML = '';
    }
    // Hide tab row and output area on clear
    const outputRow2 = document.getElementById('outputRow');
    if (outputRow2) outputRow2.style.display = 'none';
    const panelTabRow2 = document.getElementById('panelTabRow');
    if (panelTabRow2) panelTabRow2.style.display = 'none';
}

function formatNumericalValue(val) {
    if (isNaN(val)) return val.toString();
    let sign = val < 0 ? '-' : '';
    val = Math.abs(val);
    if (Math.abs(val - Math.round(val)) < 1e-7) {
        return sign + Math.round(val).toString();
    }
    let best_num = Math.round(val);
    let best_den = 1;
    let best_err = Math.abs(val - best_num);
    for (let den = 2; den <= 20; den++) {
        let num = Math.round(val * den);
        let err = Math.abs(val - num / den);
        if (err < 1e-5) {
            return sign + `${num}/${den}`;
        }
    }
    let rounded = parseFloat(val.toFixed(4));
    return sign + rounded.toString();
}

function cleanIfMessy(exprStr) {
    if (!exprStr) return exprStr;
    if (/\d{5,}/.test(exprStr) || exprStr.length > 25) {
        try {
            let val = parseFloat(nerdamer(exprStr).evaluate().text());
            return formatNumericalValue(val);
        } catch (e) {
            console.error("Error evaluating messy expression:", exprStr, e);
        }
    }
    return exprStr;
}

function cleanRootString(root) {
    if (!root) return root;
    if (!root.includes('i')) {
        return cleanIfMessy(root);
    } else {
        try {
            let sym = nerdamer(root);
            let realPart = sym.sub('i', '0').simplify().toString();
            let imagPart = sym.subtract(nerdamer(realPart)).sub('i', '1').simplify().toString();
            let absImag = imagPart.trim();
            let sign = '+';
            if (absImag.startsWith('-')) {
                absImag = absImag.slice(1).trim();
                sign = '-';
            }
            absImag = absImag.replace(/^\(-\s*/, '(');
            if (absImag.startsWith('-')) {
                absImag = absImag.slice(1).trim();
                sign = '-';
            }

            let cleanedReal = cleanIfMessy(realPart);
            let cleanedImag = cleanIfMessy(absImag);

            let res = "";
            if (cleanedReal !== '0' && cleanedReal !== 0) {
                res += cleanedReal;
                res += ` ${sign} `;
            } else if (sign === '-') {
                res += '-';
            }

            if (cleanedImag === '1') {
                res += 'i';
            } else if (cleanedImag !== '0' && cleanedImag !== 0) {
                res += `${cleanedImag}*i`;
            }
            return res;
        } catch (e) {
            console.error("Error in cleanRootString:", e);
            return root;
        }
    }
}

function higherOrderODEsolver(problem) {
    problem = problem.replaceAll('const_e', 'e');

    //Convert equation to function
    problem = problem.split('=').join('-(') + ')';

    //Check for Linearity of ODE
    if (checkLinearityODE(problem)) {
        console.log(`The given ODE is linear`);
        let char_eq = characteristicEquation(problem);
        let homogenousEq = homogenousODE(char_eq);
        console.log(`Homogenous ODE: ${homogenousEq}`);
        let coefficients = constCoefficients(homogenousEq);
        console.log(`Coefficients: ${coefficients}`);
        if (coefficients == '0') {
            let lambda_eq = convertToLambda(homogenousEq);
            console.log(`The Lambda equation for ${homogenousEq} is ${lambda_eq}`);

            let polyLHS = lambda_eq.split('=')[0];
            let rootsStr = nerdamer(`solve(factor(${polyLHS}), x)`).toString();
            console.log(`The roots of ${lambda_eq} are ${rootsStr}`);

            if (rootsStr === '[]' || rootsStr === '[ ]') {
                return '0';
            }
            let rootsList = rootsStr.slice(1, -1).split(',').map(r => r.trim()).filter(r => r !== '');

            // Verify if the symbolic roots returned by solve are correct
            let rootsAreValid = true;
            for (let root of rootsList) {
                try {
                    let testVal = nerdamer(polyLHS).sub('x', root).evaluate();
                    let magnitude = 0;
                    let text = testVal.text();
                    if (text.includes('i')) {
                        let complexVal = nerdamer(text);
                        let realPart = parseFloat(complexVal.sub('i', '0').evaluate().text());
                        let imagPart = parseFloat(complexVal.subtract(nerdamer(realPart)).sub('i', '1').evaluate().text());
                        magnitude = Math.sqrt(realPart * realPart + imagPart * imagPart);
                    } else {
                        magnitude = Math.abs(parseFloat(text));
                    }
                    if (isNaN(magnitude) || magnitude > 1e-3) {
                        rootsAreValid = false;
                        break;
                    }
                } catch (e) {
                    rootsAreValid = false;
                    break;
                }
            }

            if (!rootsAreValid) {
                console.log("Symbolic roots are invalid or failed check. Falling back to nerdamer.roots");
                try {
                    let rootsObj = nerdamer.roots(polyLHS);
                    let elements = rootsObj.symbol.elements;
                    rootsList = [];
                    for (let i = 0; i < elements.length; i++) {
                        rootsList.push(elements[i].toString());
                    }
                } catch (e) {
                    console.error("Error fallback to nerdamer.roots:", e);
                }
            }

            const_homogeneous_lambda_step = `\\text{Linear Homogeneous Constant-Coefficient ODE form: } a_n y^{(n)} + \\dots + a_0 y = 0 \\\\ \\text{Characteristic Lambda Equation: } ` + nerdamer.convertToLaTeX(polyLHS) + ` = 0`;
            const_homogeneous_roots_step = `\\text{Roots of Characteristic Equation: } \\lambda = ` + rootsList.map(r => nerdamer.convertToLaTeX(cleanRootString(r))).join(', ');

            // Helper function to get multiplicity of a root
            function getMultiplicity(eq, root) {
                let poly = eq.split('=')[0];
                let mult = 0;
                let currentPoly = poly;
                while (true) {
                    let val = nerdamer(currentPoly).sub('x', root).simplify().toString();
                    let numericVal = Math.abs(parseFloat(nerdamer(val).evaluate().text()));
                    if (val === '0' || (!isNaN(numericVal) && numericVal < 1e-4)) {
                        mult++;
                        currentPoly = `diff(${currentPoly}, x)`;
                    } else {
                        break;
                    }
                }
                return Math.max(1, mult);
            }

            // Separate unique real roots and complex pairs
            let realRootsUnique = [];
            let complexPairsUnique = [];

            for (let root of rootsList) {
                if (!root.includes('i')) {
                    let cleanedRoot = cleanIfMessy(root);
                    let exists = realRootsUnique.some(r => r.clean === cleanedRoot);
                    if (!exists) {
                        realRootsUnique.push({ raw: root, clean: cleanedRoot });
                    }
                } else {
                    // Extract real part and positive imaginary part to group conjugates
                    let sym = nerdamer(root);
                    let realPart = sym.sub('i', '0').simplify().toString();
                    let imagPart = sym.subtract(nerdamer(realPart)).sub('i', '1').simplify().toString();
                    let absImag = imagPart.trim();
                    if (absImag.startsWith('-')) {
                        absImag = absImag.slice(1).trim();
                    }
                    absImag = absImag.replace(/^\(-\s*/, '(');
                    if (absImag.startsWith('-')) {
                        absImag = absImag.slice(1).trim();
                    }

                    let cleanedReal = cleanIfMessy(realPart);
                    let cleanedImag = cleanIfMessy(absImag);

                    let exists = complexPairsUnique.some(p => p.real === cleanedReal && p.imag === cleanedImag);
                    if (!exists) {
                        complexPairsUnique.push({ raw: root, real: cleanedReal, imag: cleanedImag });
                    }
                }
            }

            let constantIndex = 0;
            let ypTerms = [];

            // 1. Process real roots
            for (let rObj of realRootsUnique) {
                let multiplicity = getMultiplicity(lambda_eq, rObj.raw);
                let r = rObj.clean;
                if (multiplicity === 1) {
                    ypTerms.push(`C_${constantIndex}*e^((${r})*x)`);
                    constantIndex++;
                } else {
                    let polyTerms = [];
                    for (let m = 0; m < multiplicity; m++) {
                        if (m === 0) {
                            polyTerms.push(`C_${constantIndex}`);
                        } else if (m === 1) {
                            polyTerms.push(`C_${constantIndex}*x`);
                        } else {
                            polyTerms.push(`C_${constantIndex}*x^${m}`);
                        }
                        constantIndex++;
                    }
                    ypTerms.push(`(${polyTerms.join(' + ')})*e^((${r})*x)`);
                }
            }

            // 2. Process complex conjugate pairs
            for (let pair of complexPairsUnique) {
                let multiplicity = getMultiplicity(lambda_eq, pair.raw);
                if (multiplicity === 1) {
                    let trigPart = `(C_${constantIndex}*cos((${pair.imag})*x) + C_${constantIndex + 1}*sin((${pair.imag})*x))`;
                    constantIndex += 2;
                    if (pair.real === '0') {
                        ypTerms.push(trigPart);
                    } else {
                        ypTerms.push(`e^((${pair.real})*x)*${trigPart}`);
                    }
                } else {
                    let cosPoly = [];
                    let sinPoly = [];
                    for (let m = 0; m < multiplicity; m++) {
                        let termStr = m === 0 ? '' : (m === 1 ? '*x' : `*x^${m}`);
                        cosPoly.push(`C_${constantIndex}${termStr}`);
                        constantIndex++;
                    }
                    for (let m = 0; m < multiplicity; m++) {
                        let termStr = m === 0 ? '' : (m === 1 ? '*x' : `*x^${m}`);
                        sinPoly.push(`C_${constantIndex}${termStr}`);
                        constantIndex++;
                    }
                    let trigPart = `((${cosPoly.join(' + ')})*cos((${pair.imag})*x) + (${sinPoly.join(' + ')})*sin((${pair.imag})*x))`;
                    if (pair.real === '0') {
                        ypTerms.push(trigPart);
                    } else {
                        ypTerms.push(`e^((${pair.real})*x)*${trigPart}`);
                    }
                }
            }

            let yp = ypTerms.join(' + ');
            console.log(`The general solution for ${homogenousEq} is ${yp}`);
            let hasMultiplicity = realRootsUnique.some(rObj => getMultiplicity(lambda_eq, rObj.raw) > 1) || complexPairsUnique.some(p => getMultiplicity(lambda_eq, p.raw) > 1);
            let hasComplex = complexPairsUnique.length > 0;
            let genSolTemplate = "";
            if (hasMultiplicity) {
                genSolTemplate = `\\text{General solution form: } y = \\sum (C_{i,0} + C_{i,1}x + \\dots) e^{\\lambda_i x}`;
            } else if (hasComplex) {
                genSolTemplate = `\\text{General solution form: } y = e^{\\alpha x}(C_1 \\cos(\\beta x) + C_2 \\sin(\\beta x))`;
            } else {
                genSolTemplate = `\\text{General solution form: } y = \\sum C_i e^{\\lambda_i x}`;
            }
            const_homogeneous_sol_step = genSolTemplate + ` \\\\ \\text{Homogeneous Solution: } y_h = ` + nerdamer.convertToLaTeX(yp);
            //Homogenus Linear ODE with constant Coefficients Solution
            if (nerdamer(`(${char_eq})-(${homogenousEq})`).toString() === '0') {
                return 'y = ' + yp;
            }
            //Non-Homogenus Linear ODE with constant Coefficients Solution
            else {
                let coeffTest = UndeterminedCoefficients(char_eq, yp);
                //Method of Variation of Parameters
                if (coeffTest === '0') {
                    yg = nonHomogenousSolver(char_eq, yp);
                    return 'y = ' + yg;
                }
                //Method of Undetermined Coefficients
                else {
                    return coeffTest;
                }
            }
        }
        //linear ODE with variable Coefficients Solution 'Euler-Cauchy Equation'
        else {
            let eulerSol = solveEulerCauchy(problem);
            if (eulerSol === '0') {
                let seriesSol = powerSeriesMethod(problem);
                if (seriesSol !== '0' && seriesSol !== 0) {
                    return seriesSol;
                }
                return '0';
            } else {
                return eulerSol;
            }
        }
    }
    //Nonlinear ODE solution
    else {
        console.log(`The given ODE is non-linear`);
        let sol = powerSeriesMethod(problem);
        if (sol == 0) {
            return '0';
        }
        else {
            return sol;
        }
    }

}



//Lengendre Polynomials
function legendrePolynomials(n) {
    function exactFact(num) {
        let r = 1;
        for (let i = 2; i <= num; i++) r *= i;
        return r;
    }
    function exactGcd(a, b) {
        a = Math.abs(a);
        b = Math.abs(b);
        while (b) {
            let t = b;
            b = a % b;
            a = t;
        }
        return a;
    }

    let terms = [];
    let M = n % 2 === 0 ? n / 2 : (n - 1) / 2;
    for (let m = 0; m <= M; m++) {
        let num = exactFact(2 * n - 2 * m);
        let den = Math.pow(2, n) * exactFact(m) * exactFact(n - m) * exactFact(n - 2 * m);
        let g = exactGcd(num, den);
        let numReduced = num / g;
        let denReduced = den / g;
        if (m % 2 === 1) {
            numReduced = -numReduced;
        }
        let coeffStr = denReduced === 1 ? `${numReduced}` : `${numReduced}/${denReduced}`;
        let power = n - 2 * m;
        if (power === 0) {
            terms.push(coeffStr);
        } else if (power === 1) {
            terms.push(`(${coeffStr})*x`);
        } else {
            terms.push(`(${coeffStr})*x^${power}`);
        }
    }
    return terms.join(' + ');
}


function nonHomogenousSolver(problem, yp) {
    let order = Number(getOrders(problem)[0].slice(1));
    let rx = getTerms(problem).filter(item => !/[Yy]/.test(item)).join('+');
    rx = rx.startsWith('-') ? `-(${rx})` : rx;
    let constNum = yp.split('C').length - 1;

    // Extract basis functions y_i without constants
    let yb = [];
    for (let i = 0; i < constNum; i++) {
        let basis = nerdamer(yp);
        for (let j = 0; j < constNum; j++) {
            basis = basis.sub(`C_${j}`, j === i ? '1' : '0');
        }
        yb.push(basis.simplify().toString());
    }
    yb = yb.filter(Boolean);
    console.log(`The basis functions of ${problem} are ${yb}`);

    // Wronskian Matrix W
    let rows = [];
    for (let d = 0; d < order; d++) {
        let rowTerms = yb.map(item => d === 0 ? item : nerdamer(`diff(${item}, x, ${d})`).toString());
        rows.push(`[${rowTerms.join(',')}]`);
    }
    let W_matrix_str = `matrix(${rows.join(',')})`;
    nerdamer.setVar('W', W_matrix_str);
    let W_det = nerdamer('determinant(W)').simplify().toString();
    console.log(`The determinant of the Wronskian Matrix is ${W_det}`);

    // sub-determinants W_i
    let Wi_dets = [];
    for (let i = 0; i < constNum; i++) {
        let Wi_rows = [];
        for (let d = 0; d < order; d++) {
            let rowTerms = yb.map((item, idx) => {
                if (idx === i) {
                    return d === order - 1 ? '1' : '0';
                } else {
                    return d === 0 ? item : nerdamer(`diff(${item}, x, ${d})`).toString();
                }
            });
            Wi_rows.push(`[${rowTerms.join(',')}]`);
        }
        let Wi_matrix_str = `matrix(${Wi_rows.join(',')})`;
        nerdamer.setVar('Wi', Wi_matrix_str);
        let Wi_det = nerdamer('determinant(Wi)').simplify().toString();
        Wi_dets.push(Wi_det);
    }

    // Solve using Variation of Parameters
    let ypTerms = [];
    for (let i = 0; i < constNum; i++) {
        let factor = `(${Wi_dets[i]})/(${W_det}) * (${rx})`;
        factor = nerdamer(factor).simplify().toString();
        let yg = TotalIntegration(factor, 'x', 1);
        ypTerms.push(`(${yb[i]}) * (${yg})`);
    }

    let y_particular = nerdamer(ypTerms.join(' + ')).simplify().toString();
    console.log(`The particular solution of ${problem}: ${y_particular}`);

    const_nonhomogeneous_method_step = `\\text{Linear Non-homogeneous Constant-Coefficient ODE form: } a_n y^{(n)} + \\dots + a_0 y = r(x) \\\\ \\text{Method used: Variation of Parameters}`;
    const_nonhomogeneous_particular_step = `\\text{General solution form: } y = y_h + y_p \\\\ \\text{Wronskian determinant } W = ` + nerdamer.convertToLaTeX(W_det) +
        `, \\quad W_i = [` + Wi_dets.map(w => nerdamer.convertToLaTeX(w)).join(', ') + `]` +
        ` \\\\ \\text{Particular solution: } y_p = ` + nerdamer.convertToLaTeX(y_particular);

    let generalSol = `${yp} + (${y_particular})`;
    return generalSol;
}

function UndeterminedCoefficients(problem, yp) {

    function getMultiplicityOfRoot(lambda_poly, rootVal) {
        let m = 0;
        let currentPoly = lambda_poly;
        while (true) {
            let val = nerdamer(currentPoly).sub('x', rootVal).simplify().toString();
            if (val === '0') {
                m++;
                currentPoly = `diff(${currentPoly}, x)`;
            } else {
                break;
            }
        }
        return m;
    }

    function symbolToFloat(sym) {
        let text = sym.evaluate().text();
        if (text.includes('/')) {
            let parts = text.split('/');
            return parseFloat(parts[0]) / parseFloat(parts[1]);
        }
        return parseFloat(text);
    }

    function toSimpleFraction(val) {
        if (isNaN(val)) return val.toString();
        let sign = val < 0 ? '-' : '';
        val = Math.abs(val);
        let best_num = Math.round(val);
        let best_den = 1;
        let best_err = Math.abs(val - best_num);

        for (let den = 1; den <= 1000; den++) {
            let num = Math.round(val * den);
            let err = Math.abs(val - num / den);
            if (err < best_err && err < 1e-9) {
                best_num = num;
                best_den = den;
                best_err = err;
            }
        }
        if (best_err < 1e-7) {
            if (best_den === 1) return sign + best_num.toString();
            return sign + `${best_num}/${best_den}`;
        }
        return sign + val.toString();
    }

    function extractExponent(term) {
        let idx = term.indexOf('const_e^');
        let len = 8;
        if (idx === -1) {
            idx = term.indexOf('e^');
            len = 2;
        }
        if (idx === -1) return 'x';
        let rest = term.slice(idx + len);
        if (rest.startsWith('(')) {
            let depth = 1;
            for (let i = 1; i < rest.length; i++) {
                if (rest[i] === '(') depth++;
                else if (rest[i] === ')') depth--;
                if (depth === 0) {
                    return rest.slice(1, i);
                }
            }
        } else {
            let starIdx = rest.indexOf('*');
            if (starIdx !== -1) {
                return rest.slice(0, starIdx);
            }
            return rest;
        }
        return 'x';
    }

    function extractTrigArg(term) {
        let idx = term.indexOf('cos(');
        if (idx === -1) idx = term.indexOf('sin(');
        if (idx === -1) return 'x';
        let rest = term.slice(idx + 4);
        let depth = 1;
        for (let i = 0; i < rest.length; i++) {
            if (rest[i] === '(') depth++;
            else if (rest[i] === ')') depth--;
            if (depth === 0) {
                return rest.slice(0, i);
            }
        }
        return 'x';
    }

    const pattern = /(const_e|e)\^|x\^|\bx\b|cos|sin/;
    let rx = getTerms(problem).filter(item => !/[Yy]/i.test(item)).join('+');
    let RXterm = rx;
    if (rx) {
        rx = nerdamer(`-(${rx})`).simplify().toString();
    }
    if (!pattern.test(rx)) {
        return '0';
    }
    else {
        let yh = getTerms(problem).filter(item => /[Yy]/i.test(item)).join('+');
        let lambda_eq = convertToLambda(yh);
        let lambda_poly = lambda_eq.split('=')[0];

        const kexpAx = /^([-+])?(((\d+(\.\d+)?(\/\d+)?)|(\([-+]?\d+(\.\d+)?(\/\d+)?\)))\*)?(const_e|e)\^(\(([\d.-]*\*?x)\)|([\d.-]*\*?x))$/;
        const kx = /^([-+])?(((\d+(\.\d+)?(\/\d+)?)|(\([-+]?\d+(\.\d+)?(\/\d+)?\)))\*x|x)$/;
        const kxPowerN = /^([-+])?(((\d+(\.\d+)?(\/\d+)?)|(\([-+]?\d+(\.\d+)?(\/\d+)?\)))\*x\^\(([\d.-]+)\)|x\^\(([\d.-]+)\))$/;
        const kcosAx = /^([-+])?(((\d+(\.\d+)?(\/\d+)?)|(\([-+]?\d+(\.\d+)?(\/\d+)?\)))\*)?cos\(([\d.-]*\*?x)\)$/;
        const ksinAx = /^([-+])?(((\d+(\.\d+)?(\/\d+)?)|(\([-+]?\d+(\.\d+)?(\/\d+)?\)))\*)?sin\(([\d.-]*\*?x)\)$/;
        const kecosAx = /^([-+])?(((\d+(\.\d+)?(\/\d+)?)|(\([-+]?\d+(\.\d+)?(\/\d+)?\)))\*)?(((const_e|e)\^(\(([\d.-]*\*?x)\)|([\d.-]*\*?x)))\*?cos\(([\d.-]*\*?x)\)|cos\(([\d.-]*\*?x)\)\*?((const_e|e)\^(\(([\d.-]*\*?x)\)|([\d.-]*\*?x))))$/;
        const kesinAx = /^([-+])?(((\d+(\.\d+)?(\/\d+)?)|(\([-+]?\d+(\.\d+)?(\/\d+)?\)))\*)?(((const_e|e)\^(\(([\d.-]*\*?x)\)|([\d.-]*\*?x)))\*?sin\(([\d.-]*\*?x)\)|sin\(([\d.-]*\*?x)\)\*?((const_e|e)\^(\(([\d.-]*\*?x)\)|([\d.-]*\*?x))))$/;

        let RX = getTerms(rx);
        console.log(`The terms in r(x) are: ${rx}`);
        let total_particular = [];
        let trial_particular_forms = [];

        for (let j = 0; j < RX.length; j++) {
            let term = RX[j];
            let ysol_term = '';
            let vars_term = [];

            if (kexpAx.test(term)) {
                let exponent = extractExponent(term);
                let e_base = term.includes('const_e^') ? 'const_e' : 'e';
                let aVal = parseFloat(nerdamer(exponent).sub('x', '1').evaluate().text());
                let m = getMultiplicityOfRoot(lambda_poly, aVal.toString());
                ysol_term = `k_0 * x^${m} * ${e_base}^(${exponent})`;
                vars_term = ['k_0'];
            }
            else if (kx.test(term)) {
                let m = getMultiplicityOfRoot(lambda_poly, '0');
                ysol_term = `x^${m} * (k_1 * x + k_0)`;
                vars_term = ['k_1', 'k_0'];
            }
            else if (kxPowerN.test(term)) {
                let match = term.match(/x\^\(([^)]+)\)/);
                let n = match ? parseInt(match[1]) : 1;
                let m = getMultiplicityOfRoot(lambda_poly, '0');
                let polyTerms = [];
                vars_term = [];
                for (let i = n; i >= 0; i--) {
                    polyTerms.push(`k_${i} * x^${i}`);
                    vars_term.push(`k_${i}`);
                }
                ysol_term = `x^${m} * (${polyTerms.join(' + ')})`;
            }
            else if (kcosAx.test(term) || ksinAx.test(term)) {
                let arg = extractTrigArg(term);
                let wVal = parseFloat(nerdamer(arg).sub('x', '1').evaluate().text());
                let m = getMultiplicityOfRoot(lambda_poly, `i * (${wVal})`);
                ysol_term = `x^${m} * (k_1 * cos(${arg}) + k_2 * sin(${arg}))`;
                vars_term = ['k_1', 'k_2'];
            }
            else if (kecosAx.test(term) || kesinAx.test(term)) {
                let exponent = extractExponent(term);
                let e_base = term.includes('const_e^') ? 'const_e' : 'e';
                let alphaVal = parseFloat(nerdamer(exponent).sub('x', '1').evaluate().text());
                let arg = extractTrigArg(term);
                let betaVal = parseFloat(nerdamer(arg).sub('x', '1').evaluate().text());
                let m = getMultiplicityOfRoot(lambda_poly, `(${alphaVal}) + i * (${betaVal})`);
                ysol_term = `x^${m} * ${e_base}^(${exponent}) * (k_1 * cos(${arg}) + k_2 * sin(${arg}))`;
                vars_term = ['k_1', 'k_2'];
            }
            else if (/^-?[\d.]+$/.test(term)) {
                let m = getMultiplicityOfRoot(lambda_poly, '0');
                ysol_term = `x^${m} * k_0`;
                vars_term = ['k_0'];
            }
            else {
                return '0';
            }
            trial_particular_forms.push(ysol_term);

            // Evaluate Homogeneous LHS with ysol_term substituted
            let lhs_eval = yh;
            let orders = getOrders(yh);
            for (let order of orders) {
                let k = parseInt(order.slice(1));
                let deriv = nerdamer(`diff(${ysol_term}, x, ${k})`).toString();
                lhs_eval = lhs_eval.replaceAll(order, `(${deriv})`);
            }
            lhs_eval = lhs_eval.replaceAll('y', `(${ysol_term})`);

            // Build linear system by evaluating at N points
            let eqs = [];
            for (let i = 1; i <= vars_term.length; i++) {
                let x_val = i + 0.5;
                let expr = `(${lhs_eval}) - (${term})`;
                let evaluated = nerdamer(expr).sub('x', x_val.toString()).evaluate().toString();

                let C0_expr = nerdamer(evaluated);
                vars_term.forEach(v => C0_expr = C0_expr.sub(v, '0'));
                let C0 = symbolToFloat(C0_expr);

                let eq_str = C0.toString();
                vars_term.forEach(v => {
                    let Cv_expr = nerdamer(evaluated);
                    vars_term.forEach(o => Cv_expr = Cv_expr.sub(o, o === v ? '1' : '0'));
                    let Cv = symbolToFloat(Cv_expr) - C0;
                    eq_str += ` + (${Cv})*${v}`;
                });
                eqs.push(eq_str);
            }

            try {
                let solution = nerdamer.solveEquations(eqs);
                if (solution.length > 0 && !Array.isArray(solution[0])) {
                    solution = [[solution[0], solution[1][0]]];
                }
                let ysol_solved = ysol_term;
                solution.forEach(sol => {
                    let varName = sol[0];
                    let rawVal = sol[1].toString();
                    let numericVal = parseFloat(nerdamer(rawVal).evaluate().text());
                    let varVal = toSimpleFraction(numericVal);
                    ysol_solved = ysol_solved.replaceAll(varName, `(${varVal})`);
                });
                total_particular.push(ysol_solved);
            } catch (err) {
                return '0';
            }
        }

        if (total_particular.length === RX.length) {
            let ypsol_final = total_particular.join(' + ');
            const_nonhomogeneous_method_step = `\\text{Linear Non-homogeneous Constant-Coefficient ODE form: } a_n y^{(n)} + \\dots + a_0 y = r(x) \\\\ \\text{Method used: Undetermined Coefficients}`;
            let clean_ypsol = cleanSolveResult(ypsol_final);
            const_nonhomogeneous_particular_step = `\\text{General solution form: } y = y_h + y_p \\\\ \\text{Trial particular solution: } y_p = ` + nerdamer.convertToLaTeX(trial_particular_forms.join(' + ')) + ` \\\\ \\text{Particular solution: } y_p = ` + nerdamer.convertToLaTeX(clean_ypsol);
            return 'y = ' + yp + ' + (' + clean_ypsol + ')';
        } else {
            return '0';
        }
    }
}

function solveEulerCauchy(problem) {
    function getMultiplicity(poly, root) {
        let mult = 0;
        let currentPoly = poly;
        while (true) {
            let val = nerdamer(currentPoly).sub('m', root).simplify().toString();
            if (val === '0') {
                mult++;
                currentPoly = `diff(${currentPoly}, m)`;
            } else {
                break;
            }
        }
        return Math.max(1, mult);
    }

    function checkEulerCauchyForm(prob) {
        let eq = prob;
        if (eq.includes('=')) {
            eq = eq.split('=').join('-(') + ')';
        }
        let rx = getTerms(eq).filter(item => !/[Yy]/.test(item)).join('+');
        rx = rx === '' ? '0' : rx;
        let hEq = nerdamer(`${eq} - (${rx})`).expand().toString();

        let Yn_order = getOrders(hEq);
        let Yn_vars = [...Yn_order];
        if (!Yn_vars.includes('y') && hEq.includes('y')) {
            Yn_vars.push('y');
        }

        let isEulerCauchy = true;
        for (let v of Yn_vars) {
            let k = v === 'y' ? 0 : Number(v.slice(1));
            let coef = nerdamer(`diff(${hEq}, ${v})`).simplify();

            let C;
            if (k === 0) {
                C = coef;
            } else {
                C = nerdamer(coef).divide(`x^${k}`).simplify();
            }

            let diffC = nerdamer(`diff(${C.toString()}, x)`).simplify().toString();
            if (diffC !== '0') {
                isEulerCauchy = false;
                break;
            }
        }
        return isEulerCauchy;
    }

    function charPolyToConstantCoeffLHS(charPoly) {
        let terms = getTerms(charPoly);
        let lhsTerms = [];
        for (let term of terms) {
            let k = 0;
            let match = term.match(/m\^(\d+)/);
            if (match) {
                k = parseInt(match[1]);
            } else if (term.includes('m')) {
                k = 1;
            }
            let c = nerdamer(term).sub('m', '1').simplify().toString();
            if (k === 0) {
                lhsTerms.push(`(${c})*y`);
            } else {
                lhsTerms.push(`(${c})*Y${k}`);
            }
        }
        return lhsTerms.join(' + ');
    }

    function transformNonHomogeneousTerm(rx) {
        return nerdamer(rx).sub('x', 'e^x').simplify().toString();
    }

    function substituteBack(sol) {
        let safe = sol;
        let prefixes = ['e^(', 'exp('];
        for (let prefix of prefixes) {
            let idx = safe.indexOf(prefix);
            while (idx !== -1) {
                let depth = 1;
                let j = idx + prefix.length;
                while (j < safe.length && depth > 0) {
                    if (safe[j] === '(') depth++;
                    else if (safe[j] === ')') depth--;
                    j++;
                }
                if (depth === 0) {
                    let inner = safe.slice(idx + prefix.length, j - 1);
                    if (inner.includes('x')) {
                        let r = nerdamer(`(${inner}) / x`).simplify().toString();
                        let fullTerm = safe.slice(idx, j);
                        let replacement = r === '1' ? '__TEMP_X__' : `(__TEMP_X__)^(${r})`;
                        safe = safe.replaceAll(fullTerm, replacement);
                    }
                }
                idx = safe.indexOf(prefix, idx + 1);
            }
        }
        safe = safe.replaceAll('e^x', '__TEMP_X__');
        safe = safe.replaceAll('x', 'log(x)');
        safe = safe.replaceAll('__TEMP_X__', 'x');
        return safe;
    }

    if (!checkEulerCauchyForm(problem)) {
        return '0';
    }

    console.log(`${problem} is in Euler-Cauchy form`);

    let Yn_order = getOrders(problem);
    let ord = Number(Yn_order[0].slice(1));

    // Generate the characteristic equation using ONLY homogeneous terms
    let allterms = getTerms(problem);
    let Yterms = allterms.filter(item => /[Yy]/.test(item));
    let homogenousProblem = Yterms.join('+');
    let newStr = homogenousProblem.replaceAll('x', '(1)');
    for (let i = 1; i <= ord; i++) {
        newStr = newStr.replaceAll(`Y${i}`, nerdamer(`diff(x^m, x, ${i})`).toString());
    }
    newStr = newStr.replaceAll(`y`, '(1)').replaceAll('x', '(1)');
    let charPoly = nerdamer(newStr).expand().toString();
    console.log(`The characteristic equation of ${problem} is: ${charPoly} = 0`);

    let roots = nerdamer(`solve(factor(${charPoly}), m)`).toString();
    console.log(`Roots found: ${roots}`);
    let rootsList = roots.slice(1, -1).split(',').map(r => r.trim()).filter(r => r !== '');

    // Verify if the symbolic roots returned by solve are correct
    let rootsAreValid = true;
    for (let root of rootsList) {
        try {
            let testVal = nerdamer(charPoly).sub('m', root).evaluate();
            let magnitude = 0;
            let text = testVal.text();
            if (text.includes('i')) {
                let complexVal = nerdamer(text);
                let realPart = parseFloat(complexVal.sub('i', '0').evaluate().text());
                let imagPart = parseFloat(complexVal.subtract(nerdamer(realPart)).sub('i', '1').evaluate().text());
                magnitude = Math.sqrt(realPart * realPart + imagPart * imagPart);
            } else {
                magnitude = Math.abs(parseFloat(text));
            }
            if (isNaN(magnitude) || magnitude > 1e-3) {
                rootsAreValid = false;
                break;
            }
        } catch (e) {
            rootsAreValid = false;
            break;
        }
    }

    if (!rootsAreValid) {
        console.log("Symbolic roots are invalid or failed check. Falling back to nerdamer.roots");
        try {
            let rootsObj = nerdamer.roots(charPoly);
            let elements = rootsObj.symbol.elements;
            rootsList = [];
            for (let i = 0; i < elements.length; i++) {
                rootsList.push(elements[i].toString());
            }
        } catch (e) {
            console.error("Error fallback to nerdamer.roots:", e);
        }
    }

    // Separate unique real roots and complex pairs
    let realRootsUnique = [];
    let complexPairsUnique = [];

    for (let root of rootsList) {
        if (!root.includes('i')) {
            let cleanedRoot = cleanIfMessy(root);
            let exists = realRootsUnique.some(r => r.clean === cleanedRoot);
            if (!exists) {
                realRootsUnique.push({ raw: root, clean: cleanedRoot });
            }
        } else {
            let sym = nerdamer(root);
            let realPart = sym.sub('i', '0').simplify().toString();
            let imagPart = sym.subtract(nerdamer(realPart)).sub('i', '1').simplify().toString();
            let absImag = imagPart.trim();
            if (absImag.startsWith('-')) {
                absImag = absImag.slice(1).trim();
            }
            absImag = absImag.replace(/^\(-\s*/, '(');
            if (absImag.startsWith('-')) {
                absImag = absImag.slice(1).trim();
            }

            let cleanedReal = cleanIfMessy(realPart);
            let cleanedImag = cleanIfMessy(absImag);

            let exists = complexPairsUnique.some(p => p.real === cleanedReal && p.imag === cleanedImag);
            if (!exists) {
                complexPairsUnique.push({ raw: root, real: cleanedReal, imag: cleanedImag });
            }
        }
    }

    let constantIndex = 0;
    let ypTerms = [];

    // 1. Process real roots
    for (let rObj of realRootsUnique) {
        let multiplicity = getMultiplicity(charPoly, rObj.raw);
        let r = rObj.clean;
        let polyTerms = [];
        for (let m = 0; m < multiplicity; m++) {
            let lnTerm = m === 0 ? '' : (m === 1 ? '*log(x)' : `*(log(x))^${m}`);
            polyTerms.push(`C_${constantIndex}${lnTerm}`);
            constantIndex++;
        }
        let termStr = multiplicity === 1 ? `C_${constantIndex - 1}` : `(${polyTerms.join(' + ')})`;
        if (r === '0') {
            ypTerms.push(termStr);
        } else {
            ypTerms.push(`${termStr}*x^(${r})`);
        }
    }

    // 2. Process complex conjugate pairs
    for (let pair of complexPairsUnique) {
        let multiplicity = getMultiplicity(charPoly, pair.raw);
        let cosPoly = [];
        let sinPoly = [];
        for (let m = 0; m < multiplicity; m++) {
            let lnTerm = m === 0 ? '' : (m === 1 ? '*log(x)' : `*(log(x))^${m}`);
            cosPoly.push(`C_${constantIndex}${lnTerm}`);
            constantIndex++;
        }
        for (let m = 0; m < multiplicity; m++) {
            let lnTerm = m === 0 ? '' : (m === 1 ? '*log(x)' : `*(log(x))^${m}`);
            sinPoly.push(`C_${constantIndex}${lnTerm}`);
            constantIndex++;
        }

        let cosTermStr = multiplicity === 1 ? `C_${constantIndex - 2}` : `(${cosPoly.join(' + ')})`;
        let sinTermStr = multiplicity === 1 ? `C_${constantIndex - 1}` : `(${sinPoly.join(' + ')})`;

        let trigPart = `(${cosTermStr}*cos((${pair.imag})*log(x)) + ${sinTermStr}*sin((${pair.imag})*log(x)))`;
        if (pair.real === '0') {
            ypTerms.push(trigPart);
        } else {
            ypTerms.push(`x^(${pair.real})*${trigPart}`);
        }
    }

    let rootsSol = ypTerms.join(' + ');

    // Check if non-homogeneous
    let rx = allterms.filter(item => !/[Yy]/.test(item));

    let hasMultiplicity = realRootsUnique.some(rObj => getMultiplicity(charPoly, rObj.raw) > 1) || complexPairsUnique.some(p => getMultiplicity(charPoly, p.raw) > 1);
    let hasComplex = complexPairsUnique.length > 0;
    let genSolTemplate = "";
    if (hasMultiplicity) {
        genSolTemplate = `\\text{General solution form: } y = (C_{i,0} + C_{i,1}\\log(x) + \\dots) x^m`;
    } else if (hasComplex) {
        genSolTemplate = `\\text{General solution form: } y = x^\\alpha(C_1 \\cos(\\beta \\log(x)) + C_2 \\sin(\\beta \\log(x)))`;
    } else {
        genSolTemplate = `\\text{General solution form: } y = \\sum C_i x^{m_i}`;
    }

    if (rx.length === 0) {
        euler_cauchy_char_step = `\\text{Euler-Cauchy Homogeneous ODE form: } x^2 y'' + a x y' + b y = 0 \\\\ \\text{Euler-Cauchy auxiliary equation: } ` + nerdamer.convertToLaTeX(charPoly) + ` = 0`;
        euler_cauchy_roots_step = `\\text{Roots of auxiliary equation: } m = ` + rootsList.map(r => nerdamer.convertToLaTeX(cleanRootString(r))).join(', ');
        euler_cauchy_sol_step = genSolTemplate + ` \\\\ \\text{Euler-Cauchy homogeneous solution: } y_h = ` + nerdamer.convertToLaTeX(rootsSol);
        return `y = ${rootsSol}`;
    } else {
        euler_cauchy_char_step = `\\text{Euler-Cauchy Non-homogeneous ODE form: } x^2 y'' + a x y' + b y = r(x) \\\\ \\text{Euler-Cauchy auxiliary equation: } ` + nerdamer.convertToLaTeX(charPoly) + ` = 0`;
        euler_cauchy_roots_step = `\\text{Roots of auxiliary equation: } m = ` + rootsList.map(r => nerdamer.convertToLaTeX(cleanRootString(r))).join(', ');
        euler_cauchy_sol_step = genSolTemplate + ` \\\\ \\text{Euler-Cauchy homogeneous solution: } y_h = ` + nerdamer.convertToLaTeX(rootsSol);

        // Solve non-homogeneous Euler-Cauchy using substitution x = e^t
        // This transforms it into a constant-coefficient ODE in t which Nerdamer can solve analytically!
        try {
            let lhs = charPolyToConstantCoeffLHS(charPoly);
            let rxStr = rx.join('+');
            let transformedRx = transformNonHomogeneousTerm(rxStr);
            let constCoeffODE = `${lhs} = -(${transformedRx})`;
            constCoeffODE = nerdamer(constCoeffODE).toString();
            console.log(`Transformed Euler-Cauchy to constant-coefficient: ${constCoeffODE}`);

            let solInT = higherOrderODEsolver(constCoeffODE);
            if (solInT && solInT !== '0') {
                let finalSol = substituteBack(solInT);
                let y_p_final = nerdamer(finalSol.replace('y =', '')).subtract(nerdamer(rootsSol)).simplify().toString();

                const_homogeneous_lambda_step = '';
                const_homogeneous_roots_step = '';
                const_homogeneous_sol_step = '';
                const_nonhomogeneous_method_step = `\\text{Euler-Cauchy Non-homogeneous ODE form: } x^2 y'' + a x y' + b y = r(x) \\\\ \\text{Method used: Substitution } x = e^t \\text{ and constant-coefficient solver}`;
                const_nonhomogeneous_particular_step = `\\text{General solution form: } y = y_h + y_p \\\\ \\text{Particular solution (after back-substitution): } y_p = ` + nerdamer.convertToLaTeX(y_p_final);
                return finalSol;
            }
        } catch (e) {
            console.error("Change of variables solver failed, falling back to Variation of Parameters:", e);
        }

        // Fallback to Variation of Parameters if change of variables fails
        let leadingCoeff = nerdamer(`diff(${problem}, ${Yn_order[0]})`).toString();
        let normalizedProblem = nerdamer(problem).divide(leadingCoeff).expand().toString();

        let yg = nonHomogenousSolver(normalizedProblem, rootsSol);
        return 'y = ' + yg;
    }
}

//Solve System of ODEs
function systemOfODEs(problem) {
    // 1. Normalize equation: convert LHS = RHS to LHS - (RHS) = 0
    let normalized = problem;
    if (normalized.includes('=')) {
        normalized = normalized.split('=').join('-(') + ')';
    }

    // 2. Check linearity and constant coefficients
    if (checkLinearityODE(normalized) && constCoefficients(normalized) === 0) {
        let hEq = homogenousODE(normalized);
        let orders = getOrders(hEq);
        let n = orders.length > 0 ? Number(orders[0].slice(1)) : 1;

        // Solve for highest order derivative Y_n
        let yn = nerdamer(`solve(${hEq}, Y${n})`).toString();
        yn = yn[0] === '[' ? yn.slice(1, -1) : yn;

        // State variables: v = [y, Y1, Y2, ..., Y_(n-1)]
        let v = ['y'];
        for (let i = 1; i < n; i++) {
            v.push(`Y${i}`);
        }

        // Build Companion Matrix A
        let A = [];
        for (let i = 0; i < n - 1; i++) {
            let row = Array(n).fill('0');
            row[i + 1] = '1';
            A.push(row);
        }
        let lastRow = [];
        for (let j = 0; j < n; j++) {
            let coeff = nerdamer(`diff(${yn}, ${v[j]})`).simplify().toString();
            lastRow.push(coeff);
        }
        A.push(lastRow);

        let detEq;
        if (n === 1) {
            detEq = `(${A[0][0]}) - l`;
        } else {
            // Set Ax variable in nerdamer
            let rowsStr = A.map(row => `[${row.join(',')}]`).join(',');
            nerdamer.setVar('Ax', `matrix(${rowsStr})`);

            // Build diagonal eigenvalue matrix Lx = l*I
            let diagonalRows = [];
            for (let i = 0; i < n; i++) {
                let row = Array(n).fill('0');
                row[i] = 'l';
                diagonalRows.push(`[${row.join(',')}]`);
            }
            nerdamer.setVar('Lx', `matrix(${diagonalRows.join(',')})`);
            detEq = nerdamer(`determinant(Ax - Lx)`).simplify().toString();
        }

        // Find characteristic equation and eigenvalues
        let eigenvaluesStr = nerdamer(`solve(${detEq}, l)`).toString();
        let eigenvalues = eigenvaluesStr[0] === '[' ? eigenvaluesStr.slice(1, -1).split(',') : [eigenvaluesStr];
        eigenvalues = eigenvalues.map(ev => ev.trim()).filter(ev => ev !== '');

        // Find unique eigenvalues and their multiplicities
        let uniqueEigenvalues = [];
        for (let ev of eigenvalues) {
            let simplified = nerdamer(ev).simplify().toString();
            if (!uniqueEigenvalues.includes(simplified)) {
                uniqueEigenvalues.push(simplified);
            }
        }

        let matrixTeX = `\\begin{pmatrix} ` + A.map(row => row.map(cell => nerdamer(cell).toTeX()).join(' & ')).join(' \\\\ ') + ` \\end{pmatrix}`;
        system_companion_matrix_step = `\\text{Linear System of First-Order ODEs form: } \\vec{x}' = A\\vec{x} \\\\ \\text{Companion Matrix } A = ` + matrixTeX;
        system_eigenvalues_step = `\\text{General solution form: } \\vec{x}(t) = \\sum C_i \\vec{v}_i e^{\\lambda_i t} \\\\ \\text{Eigenvalues of companion matrix: } \\lambda = ` + eigenvalues.map(ev => nerdamer(ev).toTeX()).join(', ');

        let constantIndex = 0;
        let terms = [];
        for (let ev of uniqueEigenvalues) {
            // Find multiplicity of ev in the characteristic equation detEq
            let mult = 0;
            let currentPoly = detEq;
            while (true) {
                let val = nerdamer(currentPoly).sub('l', ev).simplify().toString();
                if (val === '0') {
                    mult++;
                    currentPoly = `diff(${currentPoly}, l)`;
                } else {
                    break;
                }
            }
            mult = Math.max(1, mult);

            for (let m = 0; m < mult; m++) {
                let xTerm = m === 0 ? '' : (m === 1 ? '*x' : `*x^${m}`);
                terms.push(`C_${constantIndex}${xTerm}*e^((${ev})*x)`);
                constantIndex++;
            }
        }

        let Ys = terms.join(' + ');
        return 'y = ' + Ys;
    } else {
        return 0;
    }
}

function convertToLambda(problem) {
    let eq = problem + '=' + '0';
    let orders = getOrders(problem);
    for (let order of orders) {
        eq = eq.replaceAll(order, `x^${Number(order.slice(1))}`);
    }
    eq = eq.replaceAll('y', '(1)');
    return eq;
}

function constCoefficients(problem) {

    let orders = getOrders(problem);
    orders.push('y');
    let coefficients = [], x_coeff = [];
    for (let order of orders) {
        x_coeff.push(nerdamer(`diff(${problem}, ${order})`).toString());
    }
    coeff = x_coeff.map(item => nerdamer(`diff(${item}, x)`).toString());
    coeff = nerdamer(coeff.join('+')).toString();
    if (coeff === '0') {
        return 0;
    }
    else {
        return x_coeff;
    }

}

function homogenousODE(problem) {

    let rx = getTerms(problem).filter(item => !/[Yy]/.test(item)).join('+');
    rx = rx === '' ? '0' : rx;
    console.log(`r(x) = ${rx}`);
    let homogenousExp = nerdamer(`${problem} - (${rx})`).expand().toString();
    return homogenousExp;

}

function characteristicEquation(problem) {

    let highestOrder = getOrders(problem)[0];
    let dividef = nerdamer(`diff(${problem}, ${highestOrder})`).toString();
    let modified_eq = nerdamer(problem).divide(dividef).expand().toString();
    console.log(`The characteristic equation of ${problem}: ${modified_eq}`);
    return modified_eq;

}

function getOrders(problem) {

    let orders = problem.match(/Y(\d+)/g);
    orders = [...new Set(orders)];
    orders = orders.sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));
    return orders;

}

function toSimpleFraction(val) {
    if (isNaN(val)) return val.toString();
    let sign = val < 0 ? '-' : '';
    val = Math.abs(val);
    let best_num = Math.round(val);
    let best_den = 1;
    let best_err = Math.abs(val - best_num);

    for (let den = 1; den <= 1000; den++) {
        let num = Math.round(val * den);
        let err = Math.abs(val - num / den);
        if (err < best_err && err < 1e-6) {
            best_num = num;
            best_den = den;
            best_err = err;
        }
    }
    if (best_err < 1e-5) {
        if (best_den === 1) return sign + best_num.toString();
        return sign + `${best_num}/${best_den}`;
    }
    let rounded = parseFloat(val.toFixed(4));
    return sign + rounded.toString();
}

function evalNerd(expr) {
    return nerdamer(expr).evaluate().text();
}

function getTaylorCoefficients(expr, numTerms) {
    let coeffs = [];
    let currentDeriv = nerdamer(expr);
    let factVal = 1;
    for (let i = 0; i < numTerms; i++) {
        if (i > 1) {
            factVal *= i;
        }
        let valStr = evalNerd(currentDeriv.sub('x', '0').toString());
        let val = parseFloat(valStr);
        if (isNaN(val)) {
            coeffs.push(0);
        } else {
            coeffs.push(val / factVal);
        }
        currentDeriv = nerdamer(`diff(${currentDeriv.toString()}, x)`);
    }
    return coeffs;
}

function computeFrobeniusSeries(r, bCoeffs, cCoeffs, numTerms) {
    let a = [1];
    for (let n = 1; n < numTerms; n++) {
        let nr = n + r;
        let denom = nr * nr + (bCoeffs[0] - 1) * nr + cCoeffs[0];
        if (Math.abs(denom) < 1e-12) {
            return null;
        }
        let sum = 0;
        for (let j = 0; j < n; j++) {
            let b_diff = bCoeffs[n - j] || 0;
            let c_diff = cCoeffs[n - j] || 0;
            sum += (b_diff * (j + r) + c_diff) * a[j];
        }
        a.push(-sum / denom);
    }
    return a;
}

function formatSeries(coeffs) {
    let terms = [];
    for (let i = 0; i < coeffs.length; i++) {
        let c = coeffs[i];
        if (Math.abs(c) < 1e-9) continue;
        let c_str = toSimpleFraction(c);
        if (i === 0) {
            terms.push(c_str);
        } else if (i === 1) {
            terms.push(c_str === '1' ? 'x' : (c_str === '-1' ? '-x' : `${c_str}*x`));
        } else {
            terms.push(c_str === '1' ? `x^${i}` : (c_str === '-1' ? `-x^${i}` : `${c_str}*x^${i}`));
        }
    }
    let expr = terms.join(' + ').replaceAll('+ -', '- ');
    return expr;
}

function checkAndSolveLegendre(P, Q, R) {
    let c_str = P.sub('x', '0').toString();
    let c = nerdamer(c_str).simplify();
    let c_val = parseFloat(nerdamer(c.toString()).evaluate().text());
    if (isNaN(c_val) || Math.abs(c_val) < 1e-9) return null;

    let diffP = nerdamer(`${P.toString()} - (${c.toString()}) * (1 - x^2)`).simplify().toString();
    if (diffP !== '0') return null;

    let diffQ = nerdamer(`${Q.toString()} - (${c.toString()}) * (-2*x)`).simplify().toString();
    if (diffQ !== '0') return null;

    let diffR = nerdamer(`diff(${R.toString()}, x)`).simplify().toString();
    if (diffR !== '0') return null;

    let R_val_str = R.sub('x', '0').toString();
    let R_val = parseFloat(nerdamer(R_val_str).evaluate().text());
    let K = R_val / c_val;

    if (1 + 4 * K < 0) return null;
    let n = (-1 + Math.sqrt(1 + 4 * K)) / 2;
    if (n >= 0 && Math.abs(n - Math.round(n)) < 1e-9) {
        let n_int = Math.round(n);
        let Pn = legendrePolynomials(n_int);
        let Pn_simplified = nerdamer(Pn).simplify().toString();
        legendre_n_step = `\\text{Legendre ODE form: } (1-x^2)y'' - 2xy' + n(n+1)y = 0 \\quad \\text{with degree } n = ${n_int}`;
        legendre_sol_step = `\\text{General solution form: } y = C_1 P_n(x) + C_2 Q_n(x) \\\\ \\text{Legendre Polynomial } P_{${n_int}}(x) = ` + nerdamer(Pn_simplified).toTeX() +
            ` \\\\ \\text{General solution: } y = C_1 P_{${n_int}}(x) + C_2 Q_{${n_int}}(x)`;
        return `y = C_1 * (${Pn_simplified}) + C_2 * Q_${n_int}(x)`;
    }
    return null;
}

function checkAndSolveBessel(P, Q, R) {
    let c_str = P.sub('x', '1').toString();
    let c = nerdamer(c_str).simplify();
    let c_val = parseFloat(nerdamer(c.toString()).evaluate().text());
    if (isNaN(c_val) || Math.abs(c_val) < 1e-9) return null;

    let diffP = nerdamer(`${P.toString()} - (${c.toString()}) * (x^2)`).simplify().toString();
    if (diffP !== '0') return null;

    let diffQ = nerdamer(`${Q.toString()} - (${c.toString()}) * (x)`).simplify().toString();
    if (diffQ !== '0') return null;

    let K = nerdamer(`${R.toString()} - (${c.toString()}) * (x^2)`).simplify();
    let diffR = nerdamer(`diff(${K.toString()}, x)`).simplify().toString();
    if (diffR !== '0') return null;

    let K_val_str = K.sub('x', '0').toString();
    let K_val = parseFloat(nerdamer(K_val_str).evaluate().text());
    let v2 = -K_val / c_val;
    if (v2 >= 0) {
        let v = Math.sqrt(v2);
        let v_str = Number.isInteger(v) ? `${v}` : toSimpleFraction(v);
        bessel_v_step = `\\text{Bessel ODE form: } x^2 y'' + xy' + (x^2 - v^2)y = 0 \\quad \\text{with order } v = ${v_str}`;
        bessel_sol_step = `\\text{General solution form: } y = C_1 J_v(x) + C_2 Y_v(x) \\\\ \\text{General solution: } y = C_1 J_{${v_str}}(x) + C_2 Y_{${v_str}}(x)`;
        return `y = C_1*J_${v_str}(x) + C_2*Y_${v_str}(x)`;
    }
    return null;
}

function solveFrobenius(b_expr, c_expr) {
    let bCoeffs = getTaylorCoefficients(b_expr, 5);
    let cCoeffs = getTaylorCoefficients(c_expr, 5);
    let b0 = bCoeffs[0];
    let c0 = cCoeffs[0];

    let A = b0 - 1;
    let disc = A * A - 4 * c0;

    if (disc < 0) {
        return null;
    }

    let r1 = (-A + Math.sqrt(disc)) / 2;
    let r2 = (-A - Math.sqrt(disc)) / 2;

    if (r2 > r1) {
        let temp = r1;
        r1 = r2;
        r2 = temp;
    }

    let r1_str = toSimpleFraction(r1);
    let r2_str = toSimpleFraction(r2);

    let y1_coeffs = computeFrobeniusSeries(r1, bCoeffs, cCoeffs, 5);
    if (!y1_coeffs) return null;
    let y1_series = formatSeries(y1_coeffs);
    let y1_factor = (r1 === 0) ? "" : (r1 === 1 ? "x * " : `x^(${r1_str}) * `);
    let y1_str = `${y1_factor}(${y1_series})`;

    let b_coeffs_latex = bCoeffs.map(toSimpleFraction).slice(0, 4).join(', ') + ', \\dots';
    let c_coeffs_latex = cCoeffs.map(toSimpleFraction).slice(0, 4).join(', ') + ', \\dots';
    let recurrence_formula_latex = `\\text{Recurrence Relation: } a_n(r) = -\\frac{\\sum_{j=0}^{n-1} a_j \\left[b_{n-j}(j+r) + c_{n-j}\\right]}{(n+r)(n+r-1) + b_0(n+r) + c_0}`;

    let y2_str = "";
    if (Math.abs(r1 - r2) < 1e-9) {
        let r = r1;
        let b = [0];
        for (let n = 1; n < 5; n++) {
            let nr = n + r;
            let denom = nr * nr + (b0 - 1) * nr + c0;

            let sum_ab = 0;
            for (let j = 0; j < n; j++) {
                sum_ab += y1_coeffs[j] * (bCoeffs[n - j] || 0);
            }
            let hn = (1 - 2 * nr - b0) * y1_coeffs[n] - sum_ab;

            let sum_b = 0;
            for (let j = 1; j < n; j++) {
                let b_diff = bCoeffs[n - j] || 0;
                let c_diff = cCoeffs[n - j] || 0;
                sum_b += (b_diff * (j + r) + c_diff) * b[j];
            }

            b.push((hn - sum_b) / denom);
        }
        let u_series = formatSeries(b);
        let r_str = toSimpleFraction(r);
        let u_factor = (r === 0) ? "" : (r === 1 ? "x * " : `x^(${r_str}) * `);
        y2_str = `(${y1_str}) * log(x) + ${u_factor}(${u_series})`;

        frobenius_recurrence_step = recurrence_formula_latex + ` \\\\ b(x) \\text{ Taylor coefficients: } [${b_coeffs_latex}] \\\\ c(x) \\text{ Taylor coefficients: } [${c_coeffs_latex}] \\\\ ` +
            `\\text{Recurrence coefficients for } r = ${r1_str}: a = [` + y1_coeffs.map(toSimpleFraction).join(', ') + `] \\\\ ` +
            `\\text{Logarithmic second solution term coefficients: } b = [` + b.map(toSimpleFraction).join(', ') + `]`;
    } else {
        let y2_coeffs = computeFrobeniusSeries(r2, bCoeffs, cCoeffs, 5);
        if (y2_coeffs) {
            let y2_series = formatSeries(y2_coeffs);
            let y2_factor = (r2 === 0) ? "" : (r2 === 1 ? "x * " : `x^(${r2_str}) * `);
            y2_str = `${y2_factor}(${y2_series})`;

            frobenius_recurrence_step = recurrence_formula_latex + ` \\\\ b(x) \\text{ Taylor coefficients: } [${b_coeffs_latex}] \\\\ c(x) \\text{ Taylor coefficients: } [${c_coeffs_latex}] \\\\ ` +
                `\\text{Recurrence coefficients for } r_1 = ${r1_str}: a = [` + y1_coeffs.map(toSimpleFraction).join(', ') + `] \\\\ ` +
                `\\text{Recurrence coefficients for } r_2 = ${r2_str}: b = [` + y2_coeffs.map(toSimpleFraction).join(', ') + `]`;
        } else {
            let epsilon = 1e-8;
            let y2_coeffs_plus = computeFrobeniusSeries(r2 + epsilon, bCoeffs, cCoeffs, 5);
            let y2_coeffs_minus = computeFrobeniusSeries(r2 - epsilon, bCoeffs, cCoeffs, 5);
            if (y2_coeffs_plus && y2_coeffs_minus) {
                let b = [];
                for (let i = 0; i < 5; i++) {
                    b.push((y2_coeffs_plus[i] + y2_coeffs_minus[i]) / 2);
                }
                let y2_series = formatSeries(b);
                let y2_factor = (r2 === 0) ? "" : (r2 === 1 ? "x * " : `x^(${r2_str}) * `);

                let N = Math.round(r1 - r2);
                let k_val = 0;
                if (N > 0 && N < 5) {
                    k_val = epsilon * (y2_coeffs_plus[N] - y2_coeffs_minus[N]) / 2;
                }

                if (Math.abs(k_val) < 1e-9) {
                    y2_str = `${y2_factor}(${y2_series})`;
                    frobenius_recurrence_step = recurrence_formula_latex + ` \\\\ b(x) \\text{ Taylor coefficients: } [${b_coeffs_latex}] \\\\ c(x) \\text{ Taylor coefficients: } [${c_coeffs_latex}] \\\\ ` +
                        `\\text{Recurrence coefficients for } r_1 = ${r1_str}: a = [` + y1_coeffs.map(toSimpleFraction).join(', ') + `] \\\\ ` +
                        `\\text{Recurrence coefficients for } r_2 = ${r2_str}: b = [` + b.map(toSimpleFraction).join(', ') + `]`;
                } else {
                    let k_str = toSimpleFraction(k_val);
                    y2_str = `(${k_str}) * (${y1_str}) * log(x) + ${y2_factor}(${y2_series})`;
                    frobenius_recurrence_step = recurrence_formula_latex + ` \\\\ b(x) \\text{ Taylor coefficients: } [${b_coeffs_latex}] \\\\ c(x) \\text{ Taylor coefficients: } [${c_coeffs_latex}] \\\\ ` +
                        `\\text{Recurrence coefficients for } r_1 = ${r1_str}: a = [` + y1_coeffs.map(toSimpleFraction).join(', ') + `] \\\\ ` +
                        `\\text{Logarithmic term coefficient: } k = ${k_str} \\\\ ` +
                        `\\text{Second solution series coefficients: } b = [` + b.map(toSimpleFraction).join(', ') + `]`;
                }
            } else {
                let y2_factor = (r2 === 0) ? "" : (r2 === 1 ? "x * " : `x^(${r2_str}) * `);
                y2_str = `k * (${y1_str}) * log(x) + ${y2_factor}(series)`;
                frobenius_recurrence_step = recurrence_formula_latex + ` \\\\ b(x) \\text{ Taylor coefficients: } [${b_coeffs_latex}] \\\\ c(x) \\text{ Taylor coefficients: } [${c_coeffs_latex}] \\\\ ` +
                    `\\text{Recurrence coefficients for } r_1 = ${r1_str}: a = [` + y1_coeffs.map(toSimpleFraction).join(', ') + `]`;
            }
        }
    }

    let indicialEq = `r^2 + (${toSimpleFraction(A)})r + (${toSimpleFraction(c0)}) = 0`;
    frobenius_indicial_step = `\\text{Frobenius ODE form: } y'' + \\frac{b(x)}{x}y' + \\frac{c(x)}{x^2}y = 0 \\\\ \\text{Indicial equation: } ` + indicialEq + ` \\quad \\text{with roots } r_1 = ${r1_str}, \\, r_2 = ${r2_str}`;

    let finalSol = `y = C_1 * (${y1_str}) + C_2 * (${y2_str})`;

    let genForm = "";
    if (Math.abs(r1 - r2) < 1e-9) {
        genForm = `\\text{General solution form: } y = C_1 y_1(x) + C_2 y_2(x) \\text{ where } y_2(x) = y_1(x)\\log(x) + x^r \\sum b_n x^n`;
    } else {
        if (y2_str.includes('log(x)')) {
            genForm = `\\text{General solution form: } y = C_1 y_1(x) + C_2 y_2(x) \\text{ where } y_2(x) = k y_1(x)\\log(x) + x^{r_2} \\sum b_n x^n`;
        } else {
            genForm = `\\text{General solution form: } y = C_1 y_1(x) + C_2 y_2(x) \\text{ where } y_1(x) = x^{r_1} \\sum a_n x^n, \\ y_2(x) = x^{r_2} \\sum b_n x^n`;
        }
    }

    let y1_latex = "";
    let y2_latex = "";
    try {
        y1_latex = nerdamer(y1_str).toTeX();
    } catch (e) {
        y1_latex = y1_str;
    }
    try {
        y2_latex = nerdamer(y2_str).toTeX();
    } catch (e) {
        let clean_y2 = y2_str.replace(/\*/g, ' ').replace('log(x)', '\\ln(x)').replace('(series)', '\\sum_{n=0}^{\\infty} b_n x^n');
        y2_latex = clean_y2;
    }

    frobenius_sol_step = genForm + ` \\\\ \\text{First series solution: } y_1(x) = ${y1_latex} \\\\ \\text{Second series solution: } y_2(x) = ${y2_latex} \\\\ \\text{General Frobenius solution: } y = C_1 y_1(x) + C_2 y_2(x) = ` + nerdamer(finalSol.replace('y =', '')).toTeX();

    return finalSol;
}

function solvePowerSeriesOrdinary(P_expr, Q_expr, R_expr) {
    let p_expr = nerdamer(`(${Q_expr.toString()}) / (${P_expr.toString()})`).simplify();
    let q_expr = nerdamer(`(${R_expr.toString()}) / (${P_expr.toString()})`).simplify();

    let pCoeffs = getTaylorCoefficients(p_expr, 5);
    let qCoeffs = getTaylorCoefficients(q_expr, 5);

    let u = [1, 0];
    let v = [0, 1];

    for (let n = 0; n < 4; n++) {
        let sum_u = 0;
        let sum_v = 0;
        for (let j = 0; j <= n; j++) {
            let p_diff = pCoeffs[n - j] || 0;
            let q_diff = qCoeffs[n - j] || 0;
            sum_u += p_diff * (j + 1) * u[j + 1] + q_diff * u[j];
            sum_v += p_diff * (j + 1) * v[j + 1] + q_diff * v[j];
        }
        u.push(-sum_u / ((n + 1) * (n + 2)));
        v.push(-sum_v / ((n + 1) * (n + 2)));
    }

    let y1_series = formatSeries(u);
    let y2_series = formatSeries(v);

    let y1_latex = "";
    let y2_latex = "";
    try {
        y1_latex = nerdamer(y1_series).toTeX();
    } catch (e) {
        y1_latex = y1_series;
    }
    try {
        y2_latex = nerdamer(y2_series).toTeX();
    } catch (e) {
        y2_latex = y2_series;
    }

    ordinary_series_recurrence_step = `\\text{Ordinary Point Power Series form: } y'' + P(x)y' + Q(x)y = 0 \\quad (\\text{where } x=0 \\text{ is an ordinary point}) \\\\ ` +
        `\\text{Recurrence Relation: } a_{n+2} = -\\frac{\\sum_{j=0}^n \\left[(j+1)P_{n-j} a_{j+1} + Q_{n-j} a_j\\right]}{(n+1)(n+2)} \\\\ ` +
        `\\text{Series coefficients for } y_1(x) \\text{ (with } a_0=1, a_1=0\\text{): } a = [` + u.map(toSimpleFraction).join(', ') + `]` +
        ` \\\\ \\text{Series coefficients for } y_2(x) \\text{ (with } a_0=0, a_1=1\\text{): } b = [` + v.map(toSimpleFraction).join(', ') + `]`;
    let sol_expr = `C_1 * (${y1_series}) + C_2 * (${y2_series})`;
    ordinary_series_sol_step = `\\text{General solution form: } y = C_1 y_1(x) + C_2 y_2(x) \\text{ where } y_1(x) = \\sum a_n x^n, \\ y_2(x) = \\sum b_n x^n \\\\ ` +
        `\\text{First series solution: } y_1(x) = ${y1_latex} \\\\ \\text{Second series solution: } y_2(x) = ${y2_latex} \\\\ ` +
        `\\text{General power series solution: } y = ` + nerdamer(sol_expr).toTeX();

    return `y = C_1 * (${y1_series}) + C_2 * (${y2_series})`;
}

function powerSeriesMethod(problem) {
    try {
        let eq = problem;
        if (eq.includes('=')) {
            eq = eq.split('=').join('-(') + ')';
        }
        let hEq = homogenousODE(eq);
        let orders = getOrders(hEq);
        if (orders.length === 0 || Number(orders[0].slice(1)) > 2) {
            return 0;
        }

        let P = nerdamer(nerdamer(`diff(${hEq}, Y2)`).simplify().toString());
        let Q = nerdamer(nerdamer(`diff(${hEq}, Y1)`).simplify().toString());
        let R = nerdamer(nerdamer(`diff(${hEq}, y)`).simplify().toString());

        // Legendre check
        let legendreSol = checkAndSolveLegendre(P, Q, R);
        if (legendreSol) return legendreSol;

        // Bessel check
        let besselSol = checkAndSolveBessel(P, Q, R);
        if (besselSol) return besselSol;

        // Singular vs Ordinary point check at x=0
        let P_val_at_0 = parseFloat(nerdamer(P.sub('x', '0').toString()).evaluate().text());
        if (Math.abs(P_val_at_0) < 1e-9) {
            // Regular singular point Frobenius check
            let b_expr = nerdamer(`(x * (${Q.toString()})) / (${P.toString()})`).simplify();
            let c_expr = nerdamer(`(x^2 * (${R.toString()})) / (${P.toString()})`).simplify();

            let b0_val = parseFloat(nerdamer(b_expr.sub('x', '0').toString()).evaluate().text());
            let c0_val = parseFloat(nerdamer(c_expr.sub('x', '0').toString()).evaluate().text());

            if (!isNaN(b0_val) && !isNaN(c0_val) && isFinite(b0_val) && isFinite(c0_val)) {
                let frobSol = solveFrobenius(b_expr, c_expr);
                if (frobSol) return frobSol;
            }
        } else {
            // Ordinary point power series solver
            let ordSol = solvePowerSeriesOrdinary(P, Q, R);
            if (ordSol) return ordSol;
        }
    } catch (e) {
        console.error("Error in powerSeriesMethod:", e);
    }
    return 0;
}

function checkPowerSeries(problem) {
    try {
        return powerSeriesMethod(problem) !== 0;
    } catch (e) {
        return false;
    }
}

function checkLinearityODE(problem) {

    let orders = getOrders(problem);
    let i = 0;
    console.log(orders);
    let d2 = [], d_cross = [], d_y = [];
    d2.push(nerdamer(`diff(${problem},y,2)`).toString());

    for (let order of orders) {
        d2.push(nerdamer(`diff(${problem}, ${order}, 2)`).toString());
        for (i = 1; i < orders.length; i++) {
            d_cross.push(nerdamer(`diff(diff(${problem}, ${order}), ${orders[i]})`).toString());
        }
        d_y.push(nerdamer(`diff(diff(${problem}, ${order}), y)`).toString());
    }
    console.log(`d_cross: ${d_cross}, d2: ${d2}, d_y: ${d_y}`);

    d2 = nerdamer(d2.join('+')).toString();
    d_cross = nerdamer(d_cross.join('+')).toString();
    d_y = nerdamer(d_y.join('+')).toString();

    if (d2 === '0' && d_cross === '0' && d_y === '0') {
        console.log(`The given ODE ${problem} is linear`);
        return true;
    }
    else {
        console.log(`The given ODE ${problem} is non-linear`);
        return false;
    }
}

function displayMatrix() {
    // Left empty for compatibility
}

// ── Custom Symbolic Linear Algebra Engine ──

function rrefSymbolic(A) {
    let numRows = A.length;
    if (numRows === 0) return [];
    let numCols = A[0].length;
    let M = A.map(row => row.map(x => nerdamer(x)));
    let lead = 0;
    for (let r = 0; r < numRows; r++) {
        if (lead >= numCols) break;
        let i = r;
        let found = false;
        while (lead < numCols) {
            for (i = r; i < numRows; i++) {
                if (nerdamer(M[i][lead]).simplify().toString() !== '0') {
                    found = true;
                    break;
                }
            }
            if (found) break;
            lead++;
        }
        if (lead === numCols) break;
        let temp = M[i]; M[i] = M[r]; M[r] = temp;
        let pivot = M[r][lead];
        if (nerdamer(pivot).simplify().toString() !== '0') {
            for (let j = 0; j < numCols; j++) {
                M[r][j] = nerdamer(nerdamer('(' + M[r][j] + ') / (' + pivot + ')').simplify());
            }
        }
        for (let rowIdx = 0; rowIdx < numRows; rowIdx++) {
            if (rowIdx !== r) {
                let factor = M[rowIdx][lead];
                for (let colIdx = 0; colIdx < numCols; colIdx++) {
                    M[rowIdx][colIdx] = nerdamer(nerdamer('(' + M[rowIdx][colIdx] + ') - (' + factor + ') * (' + M[r][colIdx] + ')').simplify());
                }
            }
        }
        lead++;
    }
    return M;
}

function nullSpace(A) {
    let R = rrefSymbolic(A);
    let numRows = R.length;
    let numCols = R[0].length;
    let pivotCols = [];
    let rowToPivotCol = {};
    for (let r = 0; r < numRows; r++) {
        let p = -1;
        for (let c = 0; c < numCols; c++) {
            if (nerdamer(R[r][c]).simplify().toString() !== '0') {
                p = c;
                break;
            }
        }
        if (p !== -1) {
            pivotCols.push(p);
            rowToPivotCol[r] = p;
        }
    }
    let freeCols = [];
    for (let c = 0; c < numCols; c++) {
        if (!pivotCols.includes(c)) freeCols.push(c);
    }
    let basis = [];
    for (let f of freeCols) {
        let vec = Array(numCols).fill('0');
        vec[f] = '1';
        for (let r = 0; r < numRows; r++) {
            let p = rowToPivotCol[r];
            if (p !== undefined) {
                let val = nerdamer('-1 * (' + R[r][f].toString() + ')').simplify().toString();
                vec[p] = val;
            }
        }
        basis.push(vec);
    }
    return basis;
}

function symbolicDeterminant(M) {
    let n = M.length;
    if (n === 1) return nerdamer(M[0][0]);
    if (n === 2) {
        return nerdamer('(' + M[0][0] + ') * (' + M[1][1] + ') - (' + M[0][1] + ') * (' + M[1][0] + ')');
    }
    let det = nerdamer('0');
    for (let j = 0; j < n; j++) {
        let sign = (j % 2 === 0) ? '1' : '-1';
        let sub = [];
        for (let r = 1; r < n; r++) {
            let row = [];
            for (let c = 0; c < n; c++) {
                if (c !== j) row.push(M[r][c]);
            }
            sub.push(row);
        }
        let subDet = symbolicDeterminant(sub);
        det = nerdamer('(' + det + ') + (' + sign + ') * (' + M[0][j] + ') * (' + subDet + ')').simplify();
    }
    return det;
}

function calculateEigenvalues(M) {
    let n = M.rows();
    let oldAx = nerdamer.getVars('object').Ax;
    let oldLx = nerdamer.getVars('object').Lx;

    let diagonalRows = [];
    for (let i = 0; i < n; i++) {
        let row = Array(n).fill('0');
        row[i] = 'l';
        diagonalRows.push('[' + row.join(',') + ']');
    }

    nerdamer.setVar('Ax', M.toString());
    nerdamer.setVar('Lx', 'matrix(' + diagonalRows.join(',') + ')');
    let detEq = nerdamer('determinant(Ax - Lx)').simplify().toString();
    let solutions = nerdamer('solve(' + detEq + ', l)');

    if (oldAx) nerdamer.setVar('Ax', oldAx); else nerdamer.setVar('Ax', 'delete');
    if (oldLx) nerdamer.setVar('Lx', oldLx); else nerdamer.setVar('Lx', 'delete');

    return solutions;
}

function calculateEigenvectors(M) {
    let n = M.rows();
    let evsExpr = calculateEigenvalues(M);
    let evsList = [];
    if (evsExpr.symbol && evsExpr.symbol.elements) {
        evsList = evsExpr.symbol.elements.map(el => el.toString());
    } else {
        let str = evsExpr.toString();
        evsList = str[0] === '[' ? str.slice(1, -1).split(',') : [str];
    }
    evsList = evsList.map(ev => ev.trim()).filter(ev => ev !== '');

    let uniqueEvs = [];
    for (let ev of evsList) {
        let simplified = nerdamer(ev).simplify().toString();
        if (!uniqueEvs.includes(simplified)) {
            uniqueEvs.push(simplified);
        }
    }

    let results = [];
    for (let ev of uniqueEvs) {
        let B_elements = [];
        for (let i = 0; i < n; i++) {
            let row = [];
            for (let j = 0; j < n; j++) {
                let cell = M.get(i, j).toString();
                if (i === j) {
                    row.push('(' + cell + ') - (' + ev + ')');
                } else {
                    row.push(cell);
                }
            }
            B_elements.push(row);
        }
        let vecs = nullSpace(B_elements);
        results.push({
            eigenvalue: ev,
            vectors: vecs
        });
    }
    return results;
}

function formatEigenvectorsLaTeX(results) {
    let parts = [];
    for (let res of results) {
        let evTeX = nerdamer(res.eigenvalue).toTeX();
        if (res.vectors.length === 0) {
            parts.push(`\\lambda = ${evTeX} \\implies \\text{No non-trivial eigenvectors}`);
        } else {
            let vecTeXs = res.vectors.map(v => {
                let elementsTeX = v.map(x => nerdamer(x).toTeX()).join(' \\\\ ');
                return `\\begin{bmatrix} ${elementsTeX} \\end{bmatrix}`;
            });
            parts.push(`\\lambda = ${evTeX} \\implies ` + vecTeXs.join(', '));
        }
    }
    return parts.join(' \\\\ ');
}

function parseNerdamerMatrix(M) {
    let n = M.rows();
    let m = M.cols();
    let arr = [];
    for (let i = 0; i < n; i++) {
        let row = [];
        for (let j = 0; j < m; j++) {
            row.push(M.get(i, j));
        }
        arr.push(row);
    }
    return arr;
}

function formatNerdamerMatrixToBMatrix(M) {
    // Matrix.latex() returns \begin{vmatrix}...\end{vmatrix}
    // Convert to bmatrix and fix \cr → \\\\
    let tex = M.latex();
    return tex.replace(/\\begin\{vmatrix\}/g, '\\begin{bmatrix}')
        .replace(/\\end\{vmatrix\}/g, '\\end{bmatrix}')
        .replace(/\\cr/g, '\\\\');
}

// ── Global registration in Nerdamer ──
if (typeof nerdamer !== 'undefined' && typeof nerdamer.getCore === 'function') {
    const core = nerdamer.getCore();

    const originalAcos = core.PARSER.functions.acos[0];
    core.PARSER.functions.acos = [function (x) {
        if (x.toString() === '1') {
            return nerdamer('0').symbol;
        }
        return originalAcos(x);
    }, 1];

    const originalAsin = core.PARSER.functions.asin[0];
    core.PARSER.functions.asin = [function (x) {
        if (x.toString() === '0') {
            return nerdamer('0').symbol;
        }
        return originalAsin(x);
    }, 1];

    const originalDot = core.PARSER.functions.dot[0];
    core.PARSER.functions.dot = [function (A, B) {
        if (A instanceof core.Matrix) {
            let elements = [];
            let r = A.rows(), c = A.cols();
            if (r === 1 || c === 1) {
                for (let i = 0; i < r; i++) {
                    for (let j = 0; j < c; j++) {
                        elements.push(A.get(i, j));
                    }
                }
                A = new core.Vector(elements);
            }
        }
        if (B instanceof core.Matrix) {
            let elements = [];
            let r = B.rows(), c = B.cols();
            if (r === 1 || c === 1) {
                for (let i = 0; i < r; i++) {
                    for (let j = 0; j < c; j++) {
                        elements.push(B.get(i, j));
                    }
                }
                B = new core.Vector(elements);
            }
        }
        return originalDot(A, B);
    }, 2];

    const originalAbs = core.PARSER.functions.abs[0];
    core.PARSER.functions.abs = [function (x) {
        if (x instanceof core.Vector) {
            let sum = nerdamer('0').symbol;
            for (let i = 0; i < x.elements.length; i++) {
                let sq = core.PARSER.multiply(x.elements[i], x.elements[i]);
                sum = core.PARSER.add(sum, sq);
            }
            return core.PARSER.sqrt(sum);
        }
        if (x instanceof core.Matrix) {
            let r = x.rows(), c = x.cols();
            if (r === 1 || c === 1) {
                let sum = nerdamer('0').symbol;
                for (let i = 0; i < r; i++) {
                    for (let j = 0; j < c; j++) {
                        let val = x.get(i, j);
                        let sq = core.PARSER.multiply(val, val);
                        sum = core.PARSER.add(sum, sq);
                    }
                }
                return core.PARSER.sqrt(sum);
            }
        }
        return originalAbs(x);
    }, 1];

    core.PARSER.functions.determinant = [function (M) {
        if (!(M instanceof core.Matrix)) return M;
        let arr = parseNerdamerMatrix(M);
        let det = symbolicDeterminant(arr);
        return det.symbol || det;
    }, 1];

    const originalTranspose = core.PARSER.functions.transpose[0];
    core.PARSER.functions.transpose = [function (M) {
        if (M instanceof core.Vector) {
            let rows = M.elements.map(el => [el]);
            return new core.Matrix(...rows);
        }
        return originalTranspose(M);
    }, 1];

    const originalInvert = core.PARSER.functions.invert[0];
    core.PARSER.functions.invert = [function (M) {
        if (M instanceof core.Vector) {
            if (M.elements.length === 1) {
                let inv = core.PARSER.divide(nerdamer('1').symbol, M.elements[0]);
                return new core.Matrix([inv]);
            }
            throw new Error("Matrix must be square to be inverted");
        }
        return originalInvert(M);
    }, 1];

    core.PARSER.functions.rref = [function (M) {
        if (!(M instanceof core.Matrix)) return M;
        let arr = parseNerdamerMatrix(M);
        let res = rrefSymbolic(arr);
        return new core.Matrix(...res.map(row => row.map(x => x.symbol)));
    }, 1];

    core.PARSER.functions.basis = [function (M) {
        if (!(M instanceof core.Matrix)) return M;
        let arr = parseNerdamerMatrix(M);
        let numRows = arr.length;
        let numCols = arr[0].length;
        let R = rrefSymbolic(arr);
        let pivotCols = [];
        for (let r = 0; r < numRows; r++) {
            let p = -1;
            for (let c = 0; c < numCols; c++) {
                if (nerdamer(R[r][c]).simplify().toString() !== '0') {
                    p = c;
                    break;
                }
            }
            if (p !== -1) pivotCols.push(p);
        }
        let basisColumns = [];
        for (let c of pivotCols) {
            let colVec = [];
            for (let r = 0; r < numRows; r++) {
                colVec.push(arr[r][c]);
            }
            basisColumns.push(colVec.map(x => x.symbol || x));
        }
        return new core.Matrix(basisColumns);
    }, 1];

    core.PARSER.functions.eigenvalues = [function (M) {
        if (!(M instanceof core.Matrix)) return M;
        let evs = calculateEigenvalues(M);
        return evs.symbol;
    }, 1];

    core.PARSER.functions.eigenvectors = [function (M) {
        if (!(M instanceof core.Matrix)) return M;
        let results = calculateEigenvectors(M);
        let allVecs = [];
        for (let res of results) {
            for (let v of res.vectors) {
                allVecs.push(v.map(x => nerdamer(x).symbol));
            }
        }
        if (allVecs.length === 0) return M;
        return new core.Matrix(allVecs);
    }, 1];

    // Register matrix multiplication: multiply(A, B) performs proper dot-product matrix mult.
    // Nerdamer's built-in * on matrices is element-wise; this override does the correct product.
    core.PARSER.functions.multiply = [function (A, B) {
        if (A instanceof core.Matrix && B instanceof core.Matrix) {
            let rowsA = A.rows(), colsA = A.cols();
            let rowsB = B.rows(), colsB = B.cols();
            if (colsA !== rowsB) {
                throw new Error(`Matrix dimensions incompatible for multiplication: (${rowsA}×${colsA}) * (${rowsB}×${colsB})`);
            }
            let result = [];
            for (let i = 0; i < rowsA; i++) {
                let row = [];
                for (let j = 0; j < colsB; j++) {
                    // Compute sum of A[i][k] * B[k][j] for k = 0..colsA-1
                    let cell = nerdamer('0').symbol;
                    for (let k = 0; k < colsA; k++) {
                        let aik = A.get(i, k);
                        let bkj = B.get(k, j);
                        let prod = core.PARSER.multiply(aik, bkj);
                        cell = core.PARSER.add(cell, prod);
                    }
                    row.push(cell);
                }
                result.push(row);
            }
            return new core.Matrix(...result);
        }
        // Fallback: scalar multiply
        return core.PARSER.multiply(A, B);
    }, 2];
}

function getGlobalStepVariables() {
    return {
        linear_P_step,
        linear_Q_step,
        linear_IF_step,
        linear_integ_step,
        bernoulli_sub_step,
        bernoulli_linear_step,
        separable_separated_step,
        separable_integration_step,
        separable_form_step,
        separable_sol_step,
        exact_M_N_step,
        exact_verification_step,
        exact_u_step,
        exact_form_step,
        exact_sol_step,
        const_homogeneous_lambda_step,
        const_homogeneous_roots_step,
        const_homogeneous_sol_step,
        const_nonhomogeneous_method_step,
        const_nonhomogeneous_particular_step,
        euler_cauchy_char_step,
        euler_cauchy_roots_step,
        euler_cauchy_sol_step,
        system_companion_matrix_step,
        system_eigenvalues_step,
        legendre_n_step,
        legendre_sol_step,
        bessel_v_step,
        bessel_sol_step,
        frobenius_indicial_step,
        frobenius_recurrence_step,
        frobenius_sol_step,
        ordinary_series_recurrence_step,
        ordinary_series_sol_step,
        initial_value_step,
        particular_solution_step
    };
}

if (typeof module !== 'undefined') {
    module.exports = {
        getTerms,
        totalDerivative,
        productRule,
        clearSolution,
        insertImplicitStars,
        checkFalsedx,
        paranthesisValidation,
        orderValidation,
        validExpression,
        modify_inp,
        convToNerdamer,
        nerdDifferentiate,
        dydx_To_Y1,
        solveSingleOrder,
        convertTrigReciprocals,
        katexFormat,
        seperableDiff,
        higherOrderODEsolver,
        systemOfODEs,
        getGlobalStepVariables,
        getEquation,
        solveInitValue,
        parseInitialCondition,
        validateInitialConditions,
        getODEOrder,
        toolkitBackspace,
        toggleFunctionsPanel,
        toggleMoreFunctions,
        translateLatexToNerdamer,
        toggleSavedPanel,
        saveSolutionToHistory,
        clearHistory,
        renderSavedSolutions
    };
}

// ── Panel drag-to-resize ──────────────────────────────────────────
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function () {
        const resizer = document.getElementById('panelResizer');
        const leftPanel = document.getElementById('solutionPanel');
        const rightPanel = document.getElementById('plotPanel');
        const outputRow = document.getElementById('outputRow');

        if (!resizer || !leftPanel || !rightPanel) return;

        let isResizing = false;
        let startX = 0;
        let startLeftW = 0;
        let startRightW = 0;
        const MIN_WIDTH = 120; // px minimum per panel

        resizer.addEventListener('mousedown', function (e) {
            isResizing = true;
            startX = e.clientX;
            startLeftW = leftPanel.getBoundingClientRect().width;
            startRightW = rightPanel.getBoundingClientRect().width;
            resizer.classList.add('dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', function (e) {
            if (!isResizing) return;
            const dx = e.clientX - startX;
            const total = startLeftW + startRightW;
            let newLeft = startLeftW + dx;
            let newRight = startRightW - dx;

            // Clamp so neither panel disappears
            if (newLeft < MIN_WIDTH) { newLeft = MIN_WIDTH; newRight = total - MIN_WIDTH; }
            if (newRight < MIN_WIDTH) { newRight = MIN_WIDTH; newLeft = total - MIN_WIDTH; }

            leftPanel.style.flex = `0 0 ${newLeft}px`;
            rightPanel.style.flex = `0 0 ${newRight}px`;
            leftPanel.dataset.dragWidth = `${newLeft}px`;
            rightPanel.dataset.dragWidth = `${newRight}px`;
        });

        document.addEventListener('mouseup', function () {
            if (!isResizing) return;
            isResizing = false;
            resizer.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        });

        // Double-click resizer → restore equal 50/50 split
        resizer.addEventListener('dblclick', function () {
            leftPanel.style.flex = '1 1 0';
            rightPanel.style.flex = '1 1 0';
            delete leftPanel.dataset.dragWidth;
            delete rightPanel.dataset.dragWidth;
        });

        // Drag resizer 2 (between active left panel/plot panel and saved solutions panel)
        const resizer2 = document.getElementById('panelResizer2');
        const savedPanel = document.getElementById('savedPanel');
        if (resizer2 && savedPanel) {
            resizer2.addEventListener('mousedown', function (e) {
                const activeLeft = (rightPanel.style.display !== 'none') ? rightPanel : leftPanel;
                let isResizing2 = true;
                let startX = e.clientX;
                let startLeftW = activeLeft.getBoundingClientRect().width;
                let startRightW = savedPanel.getBoundingClientRect().width;
                resizer2.classList.add('dragging');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
                e.preventDefault();

                function onMouseMove(e) {
                    if (!isResizing2) return;
                    const dx = e.clientX - startX;
                    let newLeft = startLeftW + dx;
                    let newRight = startRightW - dx;

                    if (newLeft >= MIN_WIDTH && newRight >= MIN_WIDTH) {
                        activeLeft.style.flex = `0 0 ${newLeft}px`;
                        savedPanel.style.flex = `0 0 ${newRight}px`;
                        activeLeft.dataset.dragWidth = `${newLeft}px`;
                        savedPanel.dataset.dragWidth = `${newRight}px`;
                    }
                }

                function onMouseUp() {
                    isResizing2 = false;
                    resizer2.classList.remove('dragging');
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                }

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });
        }

        // Initialize history load
        renderSavedSolutions();
        // Tag mobile grids for CSS targeting
        initMobileToolkit();
        // Set initial state based on current viewport
        handleViewportTransition(window.innerWidth <= 600);
    });

    let lastWasMobile = window.innerWidth <= 600;
    // Re-tag on orientation/resize change and handle transitions
    window.addEventListener('resize', function () {
        const isMobile = window.innerWidth <= 600;
        if (isMobile) {
            initMobileToolkit();
        }
        if (isMobile !== lastWasMobile) {
            handleViewportTransition(isMobile);
            lastWasMobile = isMobile;
        }
    });
}

function handleViewportTransition(isMobile) {
    const math = document.getElementById("math");
    const ode = document.getElementById("ode");
    const overlay = document.getElementById("ode-math-overlay");
    const container = math ? math.closest('.ode-input-container') : null;
    const solutionPanel = document.getElementById('solutionPanel');
    const plotPanel = document.getElementById('plotPanel');
    const savedPanel = document.getElementById('savedPanel');
    const panelTabRow = document.getElementById('panelTabRow');
    const outputRow = document.getElementById('outputRow');
    const backdrop = document.getElementById('mobile-saved-backdrop');

    if (isMobile) {
        // Clear desktop specific inline widths/heights so CSS overrides can take over
        if (math) {
            math.style.width = '';
            math.style.height = '';
        }
        if (ode) {
            ode.style.width = '';
            ode.style.height = '';
        }
        if (overlay) {
            overlay.style.width = '';
            overlay.style.height = '';
        }
        if (container) {
            container.style.width = '';
        }

        // Hide all mobile panels by default when switching to mobile to start clean
        if (solutionPanel) {
            solutionPanel.style.display = 'none';
            solutionPanel.classList.remove('mobile-visible');
        }
        if (plotPanel) {
            plotPanel.style.display = 'none';
            plotPanel.classList.remove('mobile-visible');
        }
        if (savedPanel) {
            savedPanel.style.display = 'none';
            savedPanel.classList.remove('mobile-visible');
        }
        if (panelTabRow) panelTabRow.style.display = 'none';
        if (outputRow) outputRow.style.display = 'none';
        if (backdrop) backdrop.classList.remove('visible');
    } else {
        // Desktop: Clean up mobile specific classes and inline style overrides
        if (solutionPanel) {
            solutionPanel.style.display = '';
            solutionPanel.style.flex = '';
            solutionPanel.classList.remove('mobile-visible');
        }
        if (plotPanel) {
            plotPanel.style.display = '';
            plotPanel.style.flex = '';
            plotPanel.classList.remove('mobile-visible');
        }
        if (savedPanel) {
            savedPanel.style.display = 'none'; // Keep saved panel closed by default
            savedPanel.style.flex = '';
            savedPanel.classList.remove('mobile-visible');
        }

        // On desktop, the output panels should be visible if we have a solution
        const hasSolution = typeof window !== 'undefined' && window.mathSolverLastSolution;
        if (panelTabRow) {
            panelTabRow.style.display = hasSolution ? 'flex' : 'none';
        }
        if (outputRow) {
            outputRow.style.display = hasSolution ? 'flex' : 'none';
        }
        if (backdrop) {
            backdrop.classList.remove('visible');
            backdrop.style.display = 'none';
        }

        // Trigger resize on textareas to compute desktop-specific widths/heights
        if (math) resizeTextarea(math);
        if (ode) resizeTextarea(ode);
        if (math && window.getComputedStyle(math).display !== 'none') {
            updateMathOverlay();
        }
        updatePanelFlex();
    }
}

function syncNormalize(val, cursor) {
    let idx = 0;
    while (true) {
        idx = val.indexOf('\\frac{', idx);
        if (idx === -1) break;

        let numStart = idx + 6;
        let depth = 1;
        let j = numStart;
        while (j < val.length && depth > 0) {
            if (val[j] === '{') depth++;
            else if (val[j] === '}') depth--;
            j++;
        }
        if (depth > 0) { idx++; continue; }

        let numContent = val.substring(numStart, j - 1);

        // Only sync if the numerator contains bracket matrix or brackets or unit vectors
        if (!numContent.includes('\\begin{bmatrix}') && !numContent.includes('[') && !numContent.includes('\\hat')) {
            idx++;
            continue;
        }

        // Check if this fraction is inside a \cos^{-1} (part of angle formula)
        let isInsideCos = false;
        let lastCos = val.lastIndexOf('\\cos^{-1}', idx);
        if (lastCos !== -1) {
            let searchStart = lastCos + 9;
            let parenIdx = -1;
            for (let s = searchStart; s < val.length; s++) {
                if (val[s] === '(' || val[s] === '{') {
                    parenIdx = s;
                    break;
                }
            }
            if (parenIdx !== -1) {
                let closeChar = val[parenIdx] === '(' ? ')' : '}';
                let depth = 1;
                let c = parenIdx + 1;
                while (c < val.length && depth > 0) {
                    if (val[c] === val[parenIdx]) depth++;
                    else if (val[c] === closeChar) depth--;
                    c++;
                }
                if (depth === 0 && idx > parenIdx && idx < c) {
                    isInsideCos = true;
                }
            }
        }
        if (isInsideCos) {
            idx++;
            continue;
        }

        // Safeguard: If the numerator contains \cdot or \times, it's not a normal normalize fraction
        if (numContent.includes('\\cdot') || numContent.includes('\\times')) {
            idx++;
            continue;
        }

        // The denominator of the fraction is the next brace group:
        if (val[j] !== '{') { idx++; continue; }
        let denStart = j + 1;
        depth = 1;
        let k = denStart;
        while (k < val.length && depth > 0) {
            if (val[k] === '{') depth++;
            else if (val[k] === '}') depth--;
            k++;
        }
        if (depth > 0) { idx++; continue; }

        let denContent = val.substring(denStart, k - 1); // e.g. "\lvert []\rvert"

        // Now, we want to extract the vector part from denContent
        let denVec = "";
        let prefix = "";
        let suffix = "";

        let absPatterns = [
            { start: '\\lvert', end: '\\rvert' },
            { start: '\\left|', end: '\\right|' },
            { start: '|', end: '|' }
        ];

        let matched = false;
        for (let pat of absPatterns) {
            if (denContent.startsWith(pat.start) && denContent.endsWith(pat.end)) {
                prefix = pat.start;
                suffix = pat.end;
                denVec = denContent.substring(pat.start.length, denContent.length - pat.end.length).trim();
                matched = true;
                break;
            }
        }

        if (!matched) {
            idx++;
            continue;
        }

        if (numContent !== denVec) {
            let newDenContent = prefix + numContent + suffix;
            let before = val.substring(0, denStart);
            let after = val.substring(k - 1);
            val = before + newDenContent + after;

            let diff = newDenContent.length - denContent.length;
            if (cursor > denStart) {
                cursor += diff;
            }
            idx = 0;
        } else {
            idx++;
        }
    }
    return { val, cursor };
}

function syncAngle(val, cursor) {
    let idx = 0;
    while (true) {
        idx = val.indexOf('\\cos^{-1}', idx);
        if (idx === -1) break;

        let fracIdx = val.indexOf('\\frac{', idx);
        if (fracIdx === -1) { idx++; continue; }

        let numStart = fracIdx + 6;
        let depth = 1;
        let j = numStart;
        while (j < val.length && depth > 0) {
            if (val[j] === '{') depth++;
            else if (val[j] === '}') depth--;
            j++;
        }
        if (depth > 0) { idx++; continue; }
        let numContent = val.substring(numStart, j - 1);

        if (val[j] !== '{') { idx++; continue; }
        let denStart = j + 1;
        depth = 1;
        let k = denStart;
        while (k < val.length && depth > 0) {
            if (val[k] === '{') depth++;
            else if (val[k] === '}') depth--;
            k++;
        }
        if (depth > 0) { idx++; continue; }
        let denContent = val.substring(denStart, k - 1);

        let numVectors = extractVectors(numContent);
        let denVectors = extractVectors(denContent);

        if (numVectors.length === 2 && denVectors.length === 2) {
            let changed = false;

            if (numVectors[0].content !== denVectors[0].content) {
                let denVecStart = denStart + denVectors[0].start;
                let denVecEnd = denStart + denVectors[0].end;

                let before = val.substring(0, denVecStart);
                let after = val.substring(denVecEnd);
                val = before + numVectors[0].content + after;

                let diff = numVectors[0].content.length - denVectors[0].content.length;
                if (cursor > denVecStart) {
                    cursor += diff;
                }
                k += diff;
                denContent = val.substring(denStart, k - 1);
                denVectors = extractVectors(denContent);
                changed = true;
            }

            if (denVectors.length === 2 && numVectors[1].content !== denVectors[1].content) {
                let denVecStart = denStart + denVectors[1].start;
                let denVecEnd = denStart + denVectors[1].end;

                let before = val.substring(0, denVecStart);
                let after = val.substring(denVecEnd);
                val = before + numVectors[1].content + after;

                let diff = numVectors[1].content.length - denVectors[1].content.length;
                if (cursor > denVecStart) {
                    cursor += diff;
                }
                changed = true;
            }

            if (changed) {
                idx = 0;
            } else {
                idx++;
            }
        } else {
            idx++;
        }
    }
    return { val, cursor };
}

function extractVectors(str) {
    let results = [];
    let idx = 0;
    while (idx < str.length) {
        if (str.substring(idx).startsWith('\\begin{bmatrix}')) {
            let start = idx;
            let endB = str.indexOf('\\end{bmatrix}', start);
            if (endB !== -1) {
                let end = endB + 13;
                results.push({
                    content: str.substring(start, end),
                    start: start,
                    end: end
                });
                idx = end;
                continue;
            }
        } else if (str[idx] === '[') {
            let start = idx;
            let depth = 1;
            let j = idx + 1;
            while (j < str.length && depth > 0) {
                if (str[j] === '[') depth++;
                else if (str[j] === ']') depth--;
                j++;
            }
            if (depth === 0) {
                results.push({
                    content: str.substring(start, j),
                    start: start,
                    end: j
                });
                idx = j;
                continue;
            }
        }
        idx++;
    }
    return results;
}