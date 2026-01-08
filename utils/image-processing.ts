export async function rotateImage(file: File, degrees: number): Promise<File> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('Canvas context not available'));
                return;
            }

            // Calculate new dimensions
            // If rotating 90 or 270 degrees, swap width and height
            const rads = (degrees * Math.PI) / 180;
            const sin = Math.abs(Math.sin(rads));
            const cos = Math.abs(Math.cos(rads));

            const newWidth = img.width * cos + img.height * sin;
            const newHeight = img.width * sin + img.height * cos;

            canvas.width = newWidth;
            canvas.height = newHeight;

            // Rotate
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate(rads);
            ctx.drawImage(img, -img.width / 2, -img.height / 2);

            canvas.toBlob((blob) => {
                if (!blob) {
                    reject(new Error('Blob creation failed'));
                    return;
                }
                const newFile = new File([blob], file.name, { type: file.type, lastModified: Date.now() });
                resolve(newFile);
            }, file.type);
        };
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
    });
}
