module.exports=[56405,t=>{"use strict";var e=t.i(94775),i=t.i(21793),o=t.i(85305);let a="logo-sucursal",l="#0D2B38",n="#1B2A31",r="#55656E",d="#D8E0E4",p="#B91C1C",s="'IBM Plex Sans','Segoe UI',Helvetica,Arial,sans-serif",g="font-variant-numeric:tabular-nums;white-space:nowrap";function c(t){return String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}let h=(t="")=>`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;${t}">`;function m(t,e,i,o,a){let d=t=>`padding:5px 0;border-top:${0===t?"0":"1px solid #E8EDF0"};font-size:12.5px;line-height:1.35;color:${n}`,p=e.length?e.map(([t,e],i)=>`<tr><td style="${d(i)};padding-right:10px">${c(t)}</td><td align="right" style="${d(i)};text-align:right;${g}">${c(e)}</td></tr>`):[`<tr><td colspan="2" style="${d(0)};color:${r}">Sin ${c(t.toLowerCase())} en este per\xedodo</td></tr>`],s=Array.from({length:Math.max(0,a-Math.max(e.length,1))},()=>'<tr class="relleno"><td colspan="2" style="padding:5px 0;border-top:1px solid #FFFFFF;font-size:12.5px;line-height:1.35">&nbsp;</td></tr>'),h=`padding:7px 0 0;border-top:1px solid ${l};font-size:12.5px;line-height:1.35;font-weight:600;color:${l}`;return`<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">
    <thead><tr><th colspan="2" scope="colgroup" align="left" style="padding:0 0 6px;border-bottom:1px solid ${l};text-align:left;font-size:12.5px;font-weight:600;color:${l}">${c(t)}</th></tr></thead>
    <tbody>
      ${[...p,...s].join("\n      ")}
      <tr><td style="${h};padding-right:10px">${c(i)}</td><td align="right" style="${h};text-align:right;${g}">${c(o)}</td></tr>
    </tbody>
  </table>`}t.s(["P",0,a,"N",0,function(t){return{filename:"logo.png",content:t,contentType:"image/png",cid:a,contentDisposition:"inline"}},"r",0,function(t,a={}){var x;let $,f,b,y,u,v,w,z,E,F=a.modo??"pantalla",k=(0,o._)(t.estado),P=Math.max(t.ingresos.length,t.deducciones.length,1),j=[t.emitido?`Emitido el ${t.emitido} con ${e.f}.`:`Emitido con ${e.f}.`,o.S].join(" ");return`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Comprobante de pago del ${c(t.periodo)}</title>
<style>
  @page { size: letter; margin: 15mm; }
  @media print {
    body { background: #fff !important; }
    .no-imprimir { display: none !important; }
    .marco, .interior { padding: 0 !important; }
    .hoja { border: 0 !important; max-width: none !important; }
    .firma { page-break-inside: avoid; }
  }
  @media (max-width: 600px) {
    .marco { padding: 8px 0 !important; }
    .hoja { border-left: 0 !important; border-right: 0 !important; }
    .interior { padding: 20px 16px !important; }
    .apila { display: block !important; width: 100% !important; box-sizing: border-box; padding-left: 0 !important; padding-right: 0 !important; }
    .datos-doc, .bloque-neto { text-align: left !important; }
    .datos-doc { padding-top: 14px !important; }
    .bloque-neto { padding-top: 0 !important; }
    .columna-der { padding-top: 24px !important; }
    .fecha-firma { margin-top: 36px; }
    .relleno { display: none !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#EEF2F4;font-family:${s};color:${n}">
${"pantalla"===F?($=`display:inline-block;padding:7px 14px;border-radius:6px;font-size:13px;font-weight:500;text-decoration:none;font-family:${s}`,f=a.urlPdf?`<a href="${c(a.urlPdf)}" style="${$};color:${l};border:1px solid ${d};background:#fff">Descargar PDF</a>`:"",b=a.urlPdf?`<a href="${c(a.urlPdf)}?modo=imprimir" target="_blank" rel="noopener" title="Hoja carta con dos copias: empleado y empresa" style="${$};color:#fff;background:${l};border:1px solid ${l};margin-left:8px">Imprimir</a>`:"",f||b?`<nav class="no-imprimir" aria-label="Acciones del comprobante" style="max-width:680px;margin:0 auto;padding:16px 12px 0;text-align:right">${f}${b}</nav>`:""):""}
<main>
${h()}<tr><td class="marco" align="center" style="padding:16px 12px 32px">
  <table class="hoja" role="presentation" width="680" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:680px;border-collapse:separate;background:#fff;border:1px solid ${d};text-align:left">
    <tr><td class="interior" style="padding:32px 36px;font-family:${s}">
${k?`<p style="margin:0 0 20px;padding:9px 12px;border:1.5px solid ${p};color:${p};font-size:13px;font-weight:600">${c(k.texto)}</p>`:""}
${y=(x=a.logo)?(0,i.l)(x.ancho,x.alto,i.g,i.b):null,u=x&&y?`<img src="${c(x.src)}" width="${y.ancho}" height="${y.alto}" alt="${c(x.alt??"")}" style="display:block;border:0;margin:0 0 12px">`:"",v=t=>`<div style="font-size:12px;line-height:1.5;color:${r}">${c(t)}</div>`,w=t.fechaPago?v(`Fecha de pago ${t.fechaPago}`):"",`${h()}<tr>
  <td class="apila" valign="top" style="vertical-align:top;padding:0 24px 0 0">
    ${u}
    <div style="font-size:15px;line-height:1.35;font-weight:600;color:${l}">${c(t.empresa)}</div>
    ${(0,o.y)(t).map(v).join("\n    ")}
  </td>
  <td class="apila datos-doc" valign="top" align="right" width="210" style="vertical-align:top;text-align:right">
    <h1 style="margin:0;font-size:15px;line-height:1.35;font-weight:600;color:${l}">Comprobante de pago</h1>
    ${v(t.tipoPlanilla)}
    ${v(t.periodo)}
    ${w}
  </td>
</tr></table>`}
${z=([t,e])=>`<td valign="top" width="50%" style="vertical-align:top;padding:6px 12px 0 0;font-size:12px;line-height:1.4"><div style="color:${r}">${c(t)}</div><div style="color:${n}">${c(e)}</div></td>`,E=(0,o.a)(t).map(t=>`<tr>${t.map(z).join("")}${t.length<2?'<td width="50%"></td>':""}</tr>`),`${h(`margin-top:20px;border-top:2px solid ${l}`)}<tr>
  <td class="apila" valign="top" style="vertical-align:top;padding:16px 24px 20px 0">
    <div style="font-size:16px;line-height:1.3;font-weight:600;color:${l}">${c(t.nombreEmpleado)}</div>
    ${h("margin-top:2px")}${E.join("")}</table>
  </td>
  <td class="apila bloque-neto" valign="top" align="right" width="210" style="vertical-align:top;text-align:right;padding:16px 0 20px">
    <div style="font-size:12px;line-height:1.4;color:${r}">Neto a recibir</div>
    <div style="display:inline-block;font-size:30px;line-height:1.2;font-weight:600;color:${l};border-bottom:3px double ${l};padding-bottom:3px;${g}">${c(t.salarioNeto)}</div>
  </td>
</tr></table>`}
${h()}<tr>
  <td class="apila" valign="top" width="50%" style="vertical-align:top;padding:4px 16px 0 0">${m("Ingresos",t.ingresos,"Total devengado",t.totalBruto,P)}</td>
  <td class="apila columna-der" valign="top" width="50%" style="vertical-align:top;padding:4px 0 0 16px">${m("Deducciones",t.deducciones,"Total deducciones",t.totalDeducciones,P)}</td>
</tr></table>
${function(t,e){let i=t.netoEnLetras?`<p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:${n}"><span style="color:${r}">Son:</span> ${c(t.netoEnLetras)}</p>`:"";if(!e)return i;let o=`border-top:1px solid ${l};padding-top:5px;font-size:11.5px;line-height:1.4;color:${r}`;return`${i}
${h("margin-top:52px").replace("<table ",'<table class="firma" ')}<tr>
  <td class="apila" style="${o}">Recib\xed conforme (firma del trabajador)</td>
  <td class="relleno" width="28">&nbsp;</td>
  <td class="apila fecha-firma" width="150" style="${o}">Fecha</td>
</tr></table>`}(t,"pantalla"===F&&(0,o.M)(t))}
<p style="margin:28px 0 0;font-size:11px;line-height:1.5;color:${r}">${c(j)}</p>
    </td></tr>
  </table>
</td></tr></table>
</main>
</body>
</html>`}])}];

//# sourceMappingURL=src_lib_payroll_comprobante-html_ts_0qufwvrzr0r6e._.js.map