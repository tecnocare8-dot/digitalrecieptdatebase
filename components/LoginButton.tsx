'use client';

import { useSession, signIn, signOut } from "next-auth/react";

export default function LoginButton() {
    const { data: session } = useSession();

    if (session) {
        return (
            <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600 hidden sm:inline">{session.user?.email}</span>
                <button
                    onClick={() => signOut()}
                    className="text-sm text-red-600 hover:text-red-800 border border-red-200 rounded px-2 py-1 bg-red-50"
                >
                    ログアウト
                </button>
            </div>
        );
    }
    return (
        <button
            onClick={() => signIn('google')}
            className="text-sm text-white bg-blue-600 hover:bg-blue-700 rounded px-3 py-1 shadow-sm flex items-center gap-1"
        >
            <img src="https://www.google.com/favicon.ico" alt="G" className="w-3 h-3 bg-white rounded-full p-0.5" />
            Googleでログイン
        </button>
    );
}
