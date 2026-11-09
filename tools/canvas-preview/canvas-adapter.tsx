import React, { useEffect, useState } from 'react';
export { useState, useEffect, useMemo, useRef, useCallback } from 'react';

const palettes = {
  light: { bg: { editor: '#ffffff', chrome: '#f5f6f7', elevated: '#ffffff' }, text: { primary: '#20262d', secondary: '#59636e', tertiary: '#687480', link: '#245b9b', onAccent: '#ffffff' }, accent: { primary: '#245b9b', control: '#245b9b' }, stroke: { primary: '#c6cdd5', secondary: '#d8dee5', tertiary: '#e4e8ed' }, fill: { primary: '#e8edf3', secondary: '#f1f4f7', tertiary: '#f7f8fa' } },
  dark: { bg: { editor: '#191c20', chrome: '#14171a', elevated: '#20252a' }, text: { primary: '#e7ebef', secondary: '#acb6c1', tertiary: '#929da9', link: '#8db9f0', onAccent: '#14171a' }, accent: { primary: '#8db9f0', control: '#8db9f0' }, stroke: { primary: '#4a5561', secondary: '#39434e', tertiary: '#303941' }, fill: { primary: '#343f4b', secondary: '#28323c', tertiary: '#222a31' } }
};
export function useHostTheme() {
  const [dark, setDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const change = () => setDark(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  const tokens = palettes[dark ? 'dark' : 'light'];
  return { ...tokens, tokens, kind: dark ? 'dark' : 'light', brand: 'cursor' };
}
export function Stack({ children, gap = 16, style }: any) { return <div style={{ display: 'flex', flexDirection: 'column', gap, minWidth: 0, ...style }}>{children}</div>; }
export function Row({ children, gap = 8, align = 'center', justify, wrap, style }: any) { return <div style={{ display: 'flex', gap, alignItems: align, justifyContent: justify, flexWrap: wrap ? 'wrap' : undefined, ...style }}>{children}</div>; }
export function Grid({ children, gap = 16, columns, style }: any) { return <div className="canvas-grid" style={{ display: 'grid', gridTemplateColumns: typeof columns === 'number' ? `repeat(${columns},minmax(0,1fr))` : columns, gap, ...style }}>{children}</div>; }
export function H1({ children, style }: any) { return <h1 style={style}>{children}</h1>; }
export function H2({ children, style }: any) { return <h2 style={style}>{children}</h2>; }
export function H3({ children, style }: any) { return <h3 style={style}>{children}</h3>; }
export function Text({ children, size, tone, weight, style }: any) {
  const t = useHostTheme();
  return <p style={{ margin: 0, fontSize: size === 'small' ? 13 : 15, color: tone === 'secondary' ? t.text.secondary : undefined, fontWeight: weight === 'semibold' ? 600 : weight === 'bold' ? 700 : undefined, ...style }}>{children}</p>;
}
export function Pill({ children, active, onClick, style }: any) {
  const props = { className: `pill${active ? ' active' : ''}`, style };
  return onClick ? <button {...props} type="button" aria-pressed={!!active} onClick={onClick}>{children}</button> : <span {...props}>{children}</span>;
}
export function Table({ headers, rows, style }: any) {
  return <div className="table-frame" style={style}><table><thead><tr>{headers.map((x: any, i: number) => <th key={i} scope="col">{x}</th>)}</tr></thead><tbody>{rows.map((row: any[], i: number) => <tr key={i}>{headers.map((_: any, j: number) => <td key={j}>{row[j]}</td>)}</tr>)}</tbody></table></div>;
}
export function Card({ children, style }: any) { return <section className="card" style={style}>{children}</section>; }
export function CardHeader({ children, style }: any) { return <div className="card-header" style={style}>{children}</div>; }
export function CardBody({ children, style }: any) { return <div className="card-body" style={style}>{children}</div>; }
export function Divider({ style }: any) { return <hr style={style} />; }
export function Link({ children, href, style }: any) { return <a href={href} style={style} rel="noreferrer">{children}</a>; }
