module.exports=[9164,e=>{"use strict";var t=e.i(26248),a=e.i(66214),o=e.i(81183);let i={select:{id:!0,nombre:!0,direccion:!0,telefono:!0,rtn:!0}},n={SEMANAL:"Planilla semanal",QUINCENAL:"Planilla quincenal",MENSUAL:"Planilla mensual"};function l(e,a){return(0,t.z)(a).isZero()?[]:[[e,(0,o.q)((0,t.r)(a))]]}function r(e){return(0,t.z)(e).toDecimalPlaces(2).toString()}function d(e,t){return t.trim().toLowerCase().startsWith(`${e.toLowerCase()} `)?t.trim():`${e} ${t.trim()}`}function p(e,t){return e?.sucursal??t.sucursal??null}e.s(["_",0,{id:!0,codigo:!0,identidad:!0,primerNombre:!0,segundoNombre:!0,primerApellido:!0,segundoApellido:!0,sucursal:i,departamento:{select:{nombre:!0}},puesto:{select:{nombre:!0}}},"O",0,{select:{nombre:!0,rtn:!0,direccion:!0,telefono:!0}},"i",0,{sucursal:i,division:{select:{nombre:!0,rtn:!0}},departamento:{select:{nombre:!0}}},"y",0,function(e,i){var s,c;let m=(0,t.z)(e.ihssEmpleado).minus((0,t.z)(e.ivmEmpleado)),g=e.ihssFijo?l("IHSS — monto fijo",e.ihssEmpleado):[...l("IHSS — Enfermedad y Maternidad",m),...l("IHSS — Invalidez, Vejez y Muerte",e.ivmEmpleado)],u=p(i.ubicacion,i.empleado),h=i.ubicacion?.departamento??i.empleado.departamento,b=(0,t.z)(e.salarioNeto),f=(s=i.empresa,c=i.ubicacion?.division??null,c?.rtn?{nombre:c.nombre,rtn:c.rtn}:u?.rtn?{nombre:u.nombre,rtn:u.rtn}:{nombre:s.nombre,rtn:s.rtn}),$=(e,t)=>e.trim().toLowerCase()===t.trim().toLowerCase(),x=!u||$(u.nombre,i.empresa.nombre)||$(u.nombre,f.nombre)?null:u.nombre,y=i.ubicacion?.division?.nombre??null,v=y&&!$(y,f.nombre)?y:null;return{estado:i.planilla.estado,empresa:f.nombre,empresaRtn:f.rtn,sucursal:x,ubicacion:function(e,t,a){let[o,i]=a?["Grupo","Sucursal"]:["Sucursal","División"];return[e?d(o,e):null,t?d(i,t):null].filter(e=>!!e)}(x,v,!!i.jerarquia),direccion:u?.direccion||i.empresa.direccion||null,telefono:u?.telefono||i.empresa.telefono||null,division:v,departamento:h?.nombre??null,puesto:i.ubicacion?.puesto??i.empleado.puesto?.nombre??null,nombreEmpleado:(0,o.i)(i.empleado),codigoEmpleado:i.empleado.codigo,identidad:i.empleado.identidad??"—",periodo:`${(0,o.C)(i.planilla.fechaInicio)} al ${(0,o.C)(i.planilla.fechaFin)}`,tipoPlanilla:n[i.planilla.tipo]??i.planilla.tipo,fechaPago:i.planilla.fechaPago?(0,o.C)(i.planilla.fechaPago):null,diasTrabajados:r(e.diasTrabajados),horasExtra:r(e.horasExtra),ingresos:[...l("Salario base",e.salarioBase),...l("Horas extraordinarias",e.montoHorasExtra),...l("Bonificaciones",e.bonificaciones),...l("Otros ingresos",e.otrosIngresos)],deducciones:[...g,...l("RAP",e.rapEmpleado),...l("AFP",e.afpEmpleado),...l("ISR retenido",e.isr),...l("Impuesto vecinal",e.impuestoVecinal),...l("Cooperativa",e.cooperativa),...l("Préstamos",e.prestamos),...l("Adelantos",e.adelantos),...l("Ausencias",e.ausencias),...l(e.diasIncapacidadIhss?`Incapacidad IHSS (${e.diasIncapacidadIhss} ${1===e.diasIncapacidadIhss?"día":"días"})`:"Incapacidad IHSS",e.incapacidad??0),...l("Otras deducciones",e.otrosDeducciones)],totalBruto:(0,o.q)((0,t.r)(e.totalBruto)),totalDeducciones:(0,o.q)((0,t.r)(e.totalDeducciones)),salarioNeto:(0,o.q)((0,t.r)(e.salarioNeto)),netoEnLetras:b.isNegative()?null:(0,a.K)((0,t.r)(e.salarioNeto)),emitido:(0,o.r)(i.emitido??new Date)}},"j",0,function(e,t){let a=e.replace(/[^A-Za-z0-9_-]+/g,"-").replace(/^-+|-+$/g,"")||"empleado";return`comprobante-${a}-${t.toISOString().slice(0,10)}.pdf`},"t",0,p])},56405,e=>{"use strict";var t=e.i(94775),a=e.i(21793),o=e.i(85305);let i="logo-sucursal",n="#0D2B38",l="#1B2A31",r="#55656E",d="#D8E0E4",p="#B91C1C",s="'IBM Plex Sans','Segoe UI',Helvetica,Arial,sans-serif",c="font-variant-numeric:tabular-nums;white-space:nowrap";function m(e){return String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}let g=(e="")=>`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;${e}">`;function u(e,t,a,o,i){let d=e=>`padding:5px 0;border-top:${0===e?"0":"1px solid #E8EDF0"};font-size:12.5px;line-height:1.35;color:${l}`,p=t.length?t.map(([e,t],a)=>`<tr><td style="${d(a)};padding-right:10px">${m(e)}</td><td align="right" style="${d(a)};text-align:right;${c}">${m(t)}</td></tr>`):[`<tr><td colspan="2" style="${d(0)};color:${r}">Sin ${m(e.toLowerCase())} en este per\xedodo</td></tr>`],s=Array.from({length:Math.max(0,i-Math.max(t.length,1))},()=>'<tr class="relleno"><td colspan="2" style="padding:5px 0;border-top:1px solid #FFFFFF;font-size:12.5px;line-height:1.35">&nbsp;</td></tr>'),g=`padding:7px 0 0;border-top:1px solid ${n};font-size:12.5px;line-height:1.35;font-weight:600;color:${n}`;return`<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">
    <thead><tr><th colspan="2" scope="colgroup" align="left" style="padding:0 0 6px;border-bottom:1px solid ${n};text-align:left;font-size:12.5px;font-weight:600;color:${n}">${m(e)}</th></tr></thead>
    <tbody>
      ${[...p,...s].join("\n      ")}
      <tr><td style="${g};padding-right:10px">${m(a)}</td><td align="right" style="${g};text-align:right;${c}">${m(o)}</td></tr>
    </tbody>
  </table>`}e.s(["P",0,i,"N",0,function(e){return{filename:"logo.png",content:e,contentType:"image/png",cid:i,contentDisposition:"inline"}},"r",0,function(e,i={}){var h;let b,f,$,x,y,v,w,E,S,A=i.modo??"pantalla",z=(0,o._)(e.estado),I=Math.max(e.ingresos.length,e.deducciones.length,1),P=[e.emitido?`Emitido el ${e.emitido} con ${t.f}.`:`Emitido con ${t.f}.`,o.S].join(" ");return`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Comprobante de pago del ${m(e.periodo)}</title>
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
<body style="margin:0;padding:0;background:#EEF2F4;font-family:${s};color:${l}">
${"pantalla"===A?(b=`display:inline-block;padding:7px 14px;border-radius:6px;font-size:13px;font-weight:500;text-decoration:none;font-family:${s}`,f=i.urlPdf?`<a href="${m(i.urlPdf)}" style="${b};color:${n};border:1px solid ${d};background:#fff">Descargar PDF</a>`:"",$=i.urlPdf?`<a href="${m(i.urlPdf)}?modo=imprimir" target="_blank" rel="noopener" title="Hoja carta con dos copias: empleado y empresa" style="${b};color:#fff;background:${n};border:1px solid ${n};margin-left:8px">Imprimir</a>`:"",f||$?`<nav class="no-imprimir" aria-label="Acciones del comprobante" style="max-width:680px;margin:0 auto;padding:16px 12px 0;text-align:right">${f}${$}</nav>`:""):""}
<main>
${g()}<tr><td class="marco" align="center" style="padding:16px 12px 32px">
  <table class="hoja" role="presentation" width="680" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:680px;border-collapse:separate;background:#fff;border:1px solid ${d};text-align:left">
    <tr><td class="interior" style="padding:32px 36px;font-family:${s}">
${z?`<p style="margin:0 0 20px;padding:9px 12px;border:1.5px solid ${p};color:${p};font-size:13px;font-weight:600">${m(z.texto)}</p>`:""}
${x=(h=i.logo)?(0,a.l)(h.ancho,h.alto,a.g,a.b):null,y=h&&x?`<img src="${m(h.src)}" width="${x.ancho}" height="${x.alto}" alt="${m(h.alt??"")}" style="display:block;border:0;margin:0 0 12px">`:"",v=e=>`<div style="font-size:12px;line-height:1.5;color:${r}">${m(e)}</div>`,w=e.fechaPago?v(`Fecha de pago ${e.fechaPago}`):"",`${g()}<tr>
  <td class="apila" valign="top" style="vertical-align:top;padding:0 24px 0 0">
    ${y}
    <div style="font-size:15px;line-height:1.35;font-weight:600;color:${n}">${m(e.empresa)}</div>
    ${(0,o.y)(e).map(v).join("\n    ")}
  </td>
  <td class="apila datos-doc" valign="top" align="right" width="210" style="vertical-align:top;text-align:right">
    <h1 style="margin:0;font-size:15px;line-height:1.35;font-weight:600;color:${n}">Comprobante de pago</h1>
    ${v(e.tipoPlanilla)}
    ${v(e.periodo)}
    ${w}
  </td>
</tr></table>`}
${E=([e,t])=>`<td valign="top" width="50%" style="vertical-align:top;padding:6px 12px 0 0;font-size:12px;line-height:1.4"><div style="color:${r}">${m(e)}</div><div style="color:${l}">${m(t)}</div></td>`,S=(0,o.a)(e).map(e=>`<tr>${e.map(E).join("")}${e.length<2?'<td width="50%"></td>':""}</tr>`),`${g(`margin-top:20px;border-top:2px solid ${n}`)}<tr>
  <td class="apila" valign="top" style="vertical-align:top;padding:16px 24px 20px 0">
    <div style="font-size:16px;line-height:1.3;font-weight:600;color:${n}">${m(e.nombreEmpleado)}</div>
    ${g("margin-top:2px")}${S.join("")}</table>
  </td>
  <td class="apila bloque-neto" valign="top" align="right" width="210" style="vertical-align:top;text-align:right;padding:16px 0 20px">
    <div style="font-size:12px;line-height:1.4;color:${r}">Neto a recibir</div>
    <div style="display:inline-block;font-size:30px;line-height:1.2;font-weight:600;color:${n};border-bottom:3px double ${n};padding-bottom:3px;${c}">${m(e.salarioNeto)}</div>
  </td>
</tr></table>`}
${g()}<tr>
  <td class="apila" valign="top" width="50%" style="vertical-align:top;padding:4px 16px 0 0">${u("Ingresos",e.ingresos,"Total devengado",e.totalBruto,I)}</td>
  <td class="apila columna-der" valign="top" width="50%" style="vertical-align:top;padding:4px 0 0 16px">${u("Deducciones",e.deducciones,"Total deducciones",e.totalDeducciones,I)}</td>
</tr></table>
${function(e,t){let a=e.netoEnLetras?`<p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:${l}"><span style="color:${r}">Son:</span> ${m(e.netoEnLetras)}</p>`:"";if(!t)return a;let o=`border-top:1px solid ${n};padding-top:5px;font-size:11.5px;line-height:1.4;color:${r}`;return`${a}
${g("margin-top:52px").replace("<table ",'<table class="firma" ')}<tr>
  <td class="apila" style="${o}">Recib\xed conforme (firma del trabajador)</td>
  <td class="relleno" width="28">&nbsp;</td>
  <td class="apila fecha-firma" width="150" style="${o}">Fecha</td>
</tr></table>`}(e,"pantalla"===A&&(0,o.M)(e))}
<p style="margin:28px 0 0;font-size:11px;line-height:1.5;color:${r}">${m(P)}</p>
    </td></tr>
  </table>
</td></tr></table>
</main>
</body>
</html>`}])},85305,e=>{"use strict";let t={BORRADOR:{texto:"Borrador: planilla sin confirmar. No es un comprobante de pago.",marca:"BORRADOR"},CALCULADA:{texto:"Planilla confirmada, todavía sin aprobar. No es un comprobante de pago.",marca:"SIN APROBAR"},ANULADA:{texto:"Planilla anulada. Este comprobante no tiene validez.",marca:"ANULADA"}};function a(e){return e&&t[e]||null}e.s(["S",0,"Si encuentra una diferencia, consulte a Recursos Humanos.","_",0,a,"a",0,function(e){let t=[[["Código",e.codigoEmpleado],["Identidad",e.identidad]],[["Puesto",e.puesto],["Departamento",e.departamento]],[["Días trabajados",e.diasTrabajados],["Horas extra",Number(e.horasExtra)>0?e.horasExtra:null]]].map(e=>e.filter(e=>!!e[1])).filter(e=>e.length>0),[a,o]=t.slice(-2);return t.length>=2&&1===a.length&&1===o.length&&t.splice(-2,2,[...a,...o]),t},"y",0,function(e){return[...e.ubicacion??(e.sucursal?[`Sucursal ${e.sucursal}`]:[]),[`RTN ${e.empresaRtn}`,e.direccion,e.telefono?`Tel. ${e.telefono}`:null].filter(Boolean).join(" · ")]},"M",0,e=>!a(e.estado)])}];

//# sourceMappingURL=src_lib_payroll_0ijwips_2fo-6._.js.map