import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse';
import iconv from 'iconv-lite';

const prisma = new PrismaClient();

async function main() {
    const dataDir = path.join(process.cwd(), 'public/data');

    if (!fs.existsSync(dataDir)) {
        console.error(`Directory not found: ${dataDir}`);
        process.exit(1);
    }

    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.csv'));

    if (files.length === 0) {
        console.log('No CSV files found in public/data');
        return;
    }

    console.log(`Found ${files.length} CSV files.`);

    for (const file of files) {
        const filePath = path.join(dataDir, file);
        console.log(`Processing ${file}...`);

        // National Tax Agency CSVs are often Shift-JIS (or UTF-8 depending on download)
        // We'll try to detect or assume UTF-8 if downloaded recently, but often they are Shift-JIS.
        // Let's try reading as buffer and decoding.
        // Actually, the "All Data" download is usually UTF-8 or Shift-JIS. 
        // Let's assume standard CSV format.

        // Note: The CSV format from NTA usually has headers.
        // Column 2: Invoice Number (T + 13 digits usually just 13 digits in some CSVs, need to check)
        // Column 7: Name (Corporate Name)
        // Let's inspect the first few lines to be sure if we could.
        // But for now, we'll implement a robust parser.

        // We will use a stream to handle large files.
        const parser = fs
            .createReadStream(filePath)
            .pipe(iconv.decodeStream('utf8')) // Try Shift_JIS first as it's common for Japanese gov data
            // If it's UTF-8, this might garble. 
            // TODO: User might need to convert to UTF-8 or we detect.
            // For now, let's assume the user downloads the "CSV" which is often Shift-JIS.
            .pipe(parse({
                delimiter: ',',
                from_line: 2, // Skip header?
                relax_quotes: true,
                relax_column_count: true
            }));

        let count = 0;
        const batchSize = 1000;
        let batch: any[] = [];

        for await (const record of parser) {
            // Record structure depends on the CSV.
            // Based on NTA spec:
            // Col 1: Sequence Number
            // Col 2: Registration Number (13 digits, no T)
            // Col 3: Process Code
            // Col 4: Correct Process Code
            // Col 5: Kind Code
            // Col 6: Country Code
            // Col 7: Name
            // ...

            const regNo = record[1];
            const name = record[18]; // Column 19 (0-indexed = 18)

            if (regNo && name) {
                batch.push({
                    invoiceNumber: regNo, // Already has T prefix
                    legalName: name,
                });
            }

            if (batch.length >= batchSize) {
                await upsertBatch(batch);
                count += batch.length;
                process.stdout.write(`\rImported ${count} records...`);
                batch = [];
            }
        }

        if (batch.length > 0) {
            await upsertBatch(batch);
            count += batch.length;
        }
        console.log(`\nFinished ${file}: ${count} records.`);
    }
}

async function upsertBatch(batch: any[]) {
    // Use raw SQL for much faster bulk insert
    // SQLite's INSERT OR REPLACE is much faster than individual upserts
    const values = batch.map(item =>
        `('${item.invoiceNumber.replace(/'/g, "''")}', '${item.legalName.replace(/'/g, "''")}', datetime('now'))`
    ).join(',');

    const sql = `INSERT OR REPLACE INTO InvoiceIssuer (invoiceNumber, legalName, updatedAt) VALUES ${values}`;

    await prisma.$executeRawUnsafe(sql);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
