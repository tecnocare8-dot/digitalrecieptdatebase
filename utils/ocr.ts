import Tesseract from 'tesseract.js';

export interface ParsedReceipt {
    text: string;
    date?: string;
    invoiceNumber?: string;
    totalAmount?: number;
    companyName?: string;
    paymentMethod?: string;
}

let worker: Tesseract.Worker | null = null;

// Resize image to speed up OCR
async function resizeImage(file: File, maxDimension: number = 1500): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            let width = img.width;
            let height = img.height;

            if (width > maxDimension || height > maxDimension) {
                if (width > height) {
                    height = Math.round((height * maxDimension) / width);
                    width = maxDimension;
                } else {
                    width = Math.round((width * maxDimension) / height);
                    height = maxDimension;
                }
            } else {
                // No resize needed
                resolve(file);
                return;
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                resolve(file); // Fallback
                return;
            }
            ctx.drawImage(img, 0, 0, width, height);
            canvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else resolve(file);
            }, file.type, 0.8); // 80% quality
        };
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
    });
}

export async function cancelOCR() {
    if (worker) {
        await worker.terminate();
        worker = null;
    }
}

export async function performOCR(imageFile: File): Promise<ParsedReceipt> {
    // Resize for speed
    const resizedImageBlob = await resizeImage(imageFile);

    if (!worker) {
        worker = await Tesseract.createWorker('jpn');
    }

    const ret = await worker.recognize(resizedImageBlob);
    const page = ret.data;

    return parseReceiptText(page);
}

// Image Preprocessing: Grayscale + Binarization
async function preprocessImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                resolve(URL.createObjectURL(file)); // Fallback
                return;
            }

            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;

            // Binarization (Thresholding)
            // Simple algorithm: Convert to grayscale, then threshold
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                // Grayscale (Luminosity method)
                const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;

                // Thresholding (e.g., 128)
                // To improve, we could use Otsu's method, but fixed threshold is a good start for receipts (usually high contrast)
                // Let's use a slightly higher threshold to wash out noise
                const val = gray > 140 ? 255 : 0;

                data[i] = val;
                data[i + 1] = val;
                data[i + 2] = val;
            }

            ctx.putImageData(imageData, 0, 0);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
    });
}

function parseReceiptText(page: any): ParsedReceipt {
    const text: string = page.text;
    console.log('OCR Raw Text:', text); // Debug log
    const lines = text.split('\n');
    let date: string | undefined;
    let invoiceNumber: string | undefined;
    let totalAmount: number | undefined;
    let companyName: string | undefined;

    // --- 1. Invoice Number (Keep existing logic + Fallback + Fuzzy Correction) ---
    const invoiceRegex = /T\s*[-0-9]{13,20}/;
    const invoiceMatch = text.match(invoiceRegex);

    if (invoiceMatch) {
        const raw = invoiceMatch[0].replace(/[- ]/g, '');
        if (raw.length === 14) {
            invoiceNumber = raw;
        }
    }

    if (!invoiceNumber) {
        const labelRegex = /登録番号[:\s]*([T\d\s-]+)/;
        const labelMatch = text.match(labelRegex);
        if (labelMatch) {
            const raw = labelMatch[1].replace(/[- ]/g, '');
            if (raw.length === 13) {
                invoiceNumber = `T${raw}`;
            } else if (raw.length === 14 && raw.startsWith('T')) {
                invoiceNumber = raw;
            }
        }
    }

    // Fuzzy Correction for Invoice Number
    // T followed by 13 chars that are digits OR lookalikes (S, O, D, I, Z, B, G)
    if (!invoiceNumber) {
        const fuzzyRegex = /T\s*([0-9SODIlZBG]{13})/;
        const fuzzyMatch = text.match(fuzzyRegex);
        if (fuzzyMatch) {
            let raw = fuzzyMatch[1];
            // Normalize lookalikes
            raw = raw.replace(/S/g, '5')
                .replace(/[OD]/g, '0')
                .replace(/[Il]/g, '1')
                .replace(/Z/g, '2')
                .replace(/B/g, '8')
                .replace(/G/g, '6');
            invoiceNumber = `T${raw}`;
        }
    }

    // Fallback: Look for ANY 13-digit number (not starting with 0)
    if (!invoiceNumber) {
        // Look for 13 digits, possibly spaced? No, let's stick to contiguous for now to avoid noise.
        // Actually, Tesseract often spaces digits.
        // Let's try to find 13 digits in the whole text.
        const allDigits = text.replace(/[^\d]/g, '');
        // This is too aggressive, might merge phone numbers.

        // Per line check
        for (const line of lines) {
            // Remove non-digits
            const digits = line.replace(/[^\d]/g, '');
            if (digits.length === 13) {
                // Check if it starts with 0 (likely phone number)
                if (!digits.startsWith('0')) {
                    invoiceNumber = `T${digits}`;
                    break;
                }
            }
        }
    }

    // Define regexes at top level for reuse
    // Restrict year to 19XX or 20XX to avoid phone numbers like 0463-...
    const dateRegexJP = /((?:19|20)\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/;
    const dateRegexSlash = /((?:19|20)\d{2})[\/\.-](\d{1,2})[\/\.-](\d{1,2})/;
    const dateRegexReiwa = /R(\d{1,2})[\.\/年](\d{1,2})[\.\/月](\d{1,2})/;
    const dateRegexJPTime = /((?:19|20)\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*[\(（].*[\)）]\s*(\d{1,2}):(\d{1,2})/;
    const dateRegexTime = /((?:19|20)\d{2})[\/\.-](\d{1,2})[\/\.-](\d{1,2})\s+(\d{1,2}):(\d{1,2})/;
    // Super relaxed date regex: 20XX ... M ... D ... HH:mm (ignoring specific separators)
    const dateRegexRelaxed = /((?:19|20)\d{2})\D+(\d{1,2})\D+(\d{1,2})\D+(\d{1,2}):(\d{1,2})/;

    // --- 2. Date (Time-Anchored Strategy - Flexible & Relaxed) ---
    // User confirmed date ALWAYS has time XX:XX.
    const timeRegex = /(\d{1,2}):(\d{1,2})/;

    if (!date) {
        for (const line of lines) {
            const timeMatch = line.match(timeRegex);
            if (timeMatch) {
                // Check for YYYY, MM, DD
                const nums = line.match(/\d+/g);
                if (nums && nums.length >= 3) {
                    // Simple heuristic: First 4-digit number is year
                    const yearIdx = nums.findIndex(n => n.length === 4 && (n.startsWith('20') || n.startsWith('19')));
                    if (yearIdx !== -1) {
                        // Try relaxed regex first as it covers most cases with time
                        const matchRelaxed = line.match(dateRegexRelaxed);
                        if (matchRelaxed) {
                            date = `${matchRelaxed[1]}-${matchRelaxed[2].padStart(2, '0')}-${matchRelaxed[3].padStart(2, '0')}`;
                            break;
                        }

                        // Flexible Regex for "YYYY年 MM月 DD日 ... HH:mm"
                        const flexibleJP = /((?:19|20)\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日.*(\d{1,2}):(\d{1,2})/;
                        const matchJP = line.match(flexibleJP);

                        if (matchJP) {
                            date = `${matchJP[1]}-${matchJP[2].padStart(2, '0')}-${matchJP[3].padStart(2, '0')}`;
                            break;
                        }

                        // Also try slash format
                        const matchSlash = line.match(dateRegexSlash);
                        if (matchSlash) {
                            date = `${matchSlash[1]}-${matchSlash[2].padStart(2, '0')}-${matchSlash[3].padStart(2, '0')}`;
                            break;
                        }

                        // Garbled Separator Logic: "2025/10706" -> 10/06
                        // Look for 5-digit number in the line
                        const garbledSepMatch = line.match(/((?:19|20)\d{2}).*?(\d{5})/);
                        if (garbledSepMatch) {
                            const fiveDigits = garbledSepMatch[2];
                            // Try splitting 2-1-2 or 1-1-2?
                            // Usually Month is 1-2 digits, Day is 1-2 digits.
                            // If 5 digits: 10706 -> 10 (Oct) 7 (garbage) 06 (Day)
                            // Or 10706 -> 1 (Jan) 07 (Day) ... 06?
                            // Let's assume the middle digit is the garbage separator (slash read as 7 or 1)
                            // Try AB C DE -> Month AB, Day DE
                            const m = parseInt(fiveDigits.substring(0, 2), 10);
                            const d = parseInt(fiveDigits.substring(3, 5), 10);
                            if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
                                date = `${garbledSepMatch[1]}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
                                break;
                            }
                        }
                    }
                }

                // Garbled Date Fallback: Year is missing/garbled, but Month/Day/Time is present
                // e.g. "5 生 10 月 8H( 水 ) 13:44" -> 10月8日 13:44
                // Regex: Month + (月) + Day + (H or 日) + ... + Time
                const garbledDateRegex = /(\d{1,2})\s*月\s*(\d{1,2})\s*[H日].*(\d{1,2}):(\d{1,2})/;
                const garbledMatch = line.match(garbledDateRegex);
                if (garbledMatch) {
                    const currentYear = new Date().getFullYear();
                    // Use current year as fallback
                    date = `${currentYear}-${garbledMatch[1].padStart(2, '0')}-${garbledMatch[2].padStart(2, '0')}`;
                    break;
                }
            }
        }
    }

    // Fallback to previous regexes
    if (!date) {
        const dateMatchJPTime = text.match(dateRegexJPTime);
        const dateMatchTime = text.match(dateRegexTime);
        const dateMatchJP = text.match(dateRegexJP);
        const dateMatchSlash = text.match(dateRegexSlash);
        const dateMatchReiwa = text.match(dateRegexReiwa);

        if (dateMatchJPTime) {
            date = `${dateMatchJPTime[1]}-${dateMatchJPTime[2].padStart(2, '0')}-${dateMatchJPTime[3].padStart(2, '0')}`;
        } else if (dateMatchTime) {
            date = `${dateMatchTime[1]}-${dateMatchTime[2].padStart(2, '0')}-${dateMatchTime[3].padStart(2, '0')}`;
        } else if (dateMatchJP) {
            date = `${dateMatchJP[1]}-${dateMatchJP[2].padStart(2, '0')}-${dateMatchJP[3].padStart(2, '0')}`;
        } else if (dateMatchSlash) {
            date = `${dateMatchSlash[1]}-${dateMatchSlash[2].padStart(2, '0')}-${dateMatchSlash[3].padStart(2, '0')}`;
        } else if (dateMatchReiwa) {
            const year = 2018 + parseInt(dateMatchReiwa[1], 10);
            date = `${year}-${dateMatchReiwa[2].padStart(2, '0')}-${dateMatchReiwa[3].padStart(2, '0')}`;
        }
    }

    // Fallback: Look for any line with Year/Month/Day kanji
    if (!date) {
        for (const line of lines) {
            if (line.includes('年') && line.includes('月') && line.includes('日')) {
                const nums = line.match(/\d+/g);
                if (nums && nums.length >= 3) {
                    const y = parseInt(nums[0], 10);
                    const m = parseInt(nums[1], 10);
                    const d = parseInt(nums[2], 10);
                    if (y > 2000 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
                        date = `${y}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
                        break;
                    }
                }
            }
        }
    }

    // --- 3. Price (Priority Strategy: Keywords > Max Value) ---
    let maxFoundAmount = 0;
    const keywordCandidates: number[] = [];
    const symbolCandidates: number[] = [];

    // Expanded keywords including garbled versions of "合計"
    const priceKeywords = [
        '合計', '小計', 'Total', 'Amount',
        '全言十', '合十', '全計', '言十', // Garbled "合計"
        '支払', '領収'
    ];

    for (const line of lines) {
        let isKeywordLine = false;

        // 1. Check for keywords (Regex to allow spaces)
        for (const keyword of priceKeywords) {
            // Create regex that allows spaces between characters
            // e.g. "全言十" -> /全\s*言\s*十/
            const keywordPattern = keyword.split('').join('\\s*');
            const keywordRegex = new RegExp(keywordPattern);

            const matchKeyword = line.match(keywordRegex);
            if (matchKeyword) {
                isKeywordLine = true;
                // Get text AFTER the match
                const afterKeyword = line.substring(matchKeyword.index! + matchKeyword[0].length);

                // Look for ANY digit sequence after keyword, handling spaces
                // Regex: capture first sequence of digits/spaces/commas/dots
                const relaxedNumRegex = /([\d\s,.]+)/;
                const match = afterKeyword.match(relaxedNumRegex);
                if (match) {
                    // Remove commas, spaces, AND dots (OCR often mistakes , for .)
                    const raw = match[1].replace(/[,\s.]/g, '');
                    const val = parseInt(raw, 10);
                    if (!isNaN(val) && val > 0) {
                        keywordCandidates.push(val);
                    }
                }
            }
        }

        // 2. Check for explicit price symbols (Fallbacks)
        // Include 'y' as a symbol
        if (line.includes('¥') || line.includes('￥') || line.includes('\\') || line.includes('y')) {
            const yenRegex = /[¥￥\\y]\s*([\d\s,.]+)/g;
            let match;
            while ((match = yenRegex.exec(line)) !== null) {
                const rawNum = match[1].replace(/[,\s.]/g, '');
                const val = parseInt(rawNum, 10);
                if (!isNaN(val) && val > 0) {
                    if (isKeywordLine) {
                        keywordCandidates.push(val);
                    } else {
                        symbolCandidates.push(val);
                    }
                }
            }
        }

        if (!isKeywordLine && line.includes('円')) {
            const yenSuffixRegex = /([\d\s,.]+)\s*円/g;
            let match;
            while ((match = yenSuffixRegex.exec(line)) !== null) {
                const rawNum = match[1].replace(/[,\s.]/g, '');
                const val = parseInt(rawNum, 10);
                if (!isNaN(val) && val > 0) {
                    symbolCandidates.push(val);
                }
            }
        }
    }

    // Decision Logic:
    // 1. If we have keyword candidates, take the MAX of those.
    // 2. If not, take the MAX of symbol candidates.

    if (keywordCandidates.length > 0) {
        maxFoundAmount = Math.max(...keywordCandidates);
    } else if (symbolCandidates.length > 0) {
        maxFoundAmount = Math.max(...symbolCandidates);
    }

    if (maxFoundAmount > 0) {
        totalAmount = maxFoundAmount;
    }

    // --- 4. Company Name (Keep existing logic) ---
    const cleanLines = lines.map(l => l.trim()).filter(l => l.length > 0);
    for (const line of cleanLines) {
        if (dateRegexJP.test(line) || dateRegexSlash.test(line) || dateRegexReiwa.test(line)) continue;
        if (line.includes('登録番号') || (invoiceNumber && line.includes(invoiceNumber))) continue;
        if (/\d{2,4}-\d{2,4}-\d{4}/.test(line)) continue;
        if (line.length < 3) continue;
        companyName = line;
        break;
    }

    // --- 4. Payment Method Detection ---
    let paymentMethod = '現金'; // Default
    const creditKeywords = ['クレジット', 'カード', 'VISA', 'Master', 'JCB', 'Amex', 'Diners', 'Discover'];
    const emoneyKeywords = ['電子マネー', '交通系', 'Suica', 'Pasmo', 'ICOCA', 'PayPay', 'd払い', 'auPAY', 'Rpay', '楽天ペイ', 'QUICPay', 'iD', 'IC'];

    // Check for keywords
    let isCredit = false;
    let isEmoney = false;

    for (const line of lines) {
        for (const kw of creditKeywords) {
            if (line.includes(kw)) isCredit = true;
        }
        for (const kw of emoneyKeywords) {
            if (line.includes(kw)) isEmoney = true;
        }
    }

    if (isCredit) {
        paymentMethod = 'クレジットカード';
    } else if (isEmoney) {
        paymentMethod = '電子マネー';
    }
    // If neither, keep default '現金' (Cash)

    return {
        text,
        date,
        invoiceNumber,
        totalAmount,
        companyName,
        paymentMethod
    };
}
