import { useState } from 'react';

interface Props {
    src: string;
    onRotate: (degrees: number) => void;
}

export default function ImagePreview({ src, onRotate }: Props) {
    const [scale, setScale] = useState(1);

    const handleZoomIn = () => setScale(s => Math.min(s + 0.5, 3)); // Max 3x
    const handleZoomOut = () => setScale(s => Math.max(s - 0.5, 0.5)); // Min 0.5x
    const handleReset = () => setScale(1);

    return (
        <div className="mb-6">
            {/* Controls - Outside the image */}
            <div className="flex justify-center gap-2 mb-2 bg-gray-100 p-2 rounded-lg">
                <button
                    type="button"
                    onClick={() => onRotate(-90)}
                    className="p-2 hover:bg-gray-200 rounded-md text-gray-700 font-bold w-10 h-10 flex items-center justify-center"
                    title="左回転"
                >
                    ↺
                </button>
                <button
                    type="button"
                    onClick={() => onRotate(90)}
                    className="p-2 hover:bg-gray-200 rounded-md text-gray-700 font-bold w-10 h-10 flex items-center justify-center"
                    title="右回転"
                >
                    ↻
                </button>
                <div className="w-px bg-gray-400 mx-1"></div>
                <button
                    type="button"
                    onClick={handleZoomOut}
                    className="p-2 hover:bg-gray-200 rounded-md text-gray-700 font-bold w-10 h-10 flex items-center justify-center"
                    title="縮小"
                >
                    －
                </button>
                <button
                    type="button"
                    onClick={handleReset}
                    className="p-2 hover:bg-gray-200 rounded-md text-gray-700 text-xs px-3"
                    title="リセット"
                >
                    {Math.round(scale * 100)}%
                </button>
                <button
                    type="button"
                    onClick={handleZoomIn}
                    className="p-2 hover:bg-gray-200 rounded-md text-gray-700 font-bold w-10 h-10 flex items-center justify-center"
                    title="拡大"
                >
                    ＋
                </button>
            </div>

            {/* Image Container */}
            <div className="border rounded-lg overflow-hidden bg-gray-50">
                <div className="overflow-auto max-h-[60vh] p-2 flex justify-center items-start">
                    <img
                        src={src}
                        alt="Preview"
                        style={{
                            transform: `scale(${scale})`,
                            transformOrigin: 'top center',
                            transition: 'transform 0.2s ease-out'
                        }}
                        className="max-w-full shadow-sm"
                    />
                </div>
            </div>
        </div>
    );
}
