import type { Metadata } from "next";
import { Bonbon, Geist, Geist_Mono } from "next/font/google";
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

const bonbon = Bonbon({
  variable: "--font-bonbon",
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
      className={`${geistSans.variable} ${geistMono.variable} ${bonbon.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Splash />
        {children}
      </body>
    </html>
  );
}
