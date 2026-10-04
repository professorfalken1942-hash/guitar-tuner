import type { Metadata } from "next";
import { Damion, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Splash from "./splash";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const damion = Damion({
  variable: "--font-damion",
  weight: "400",
  display: "block",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Trootone · Guitar Tuner",
  description: "Free in-browser chromatic guitar tuner with standard and alternate tunings.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${damion.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Splash />
        {children}
      </body>
    </html>
  );
}
