import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  escaparHtml,
  celdaCsv,
  nombreArchivoSeguro,
  normalizarFormato,
  BOM_UTF8,
} from "@/lib/reportes/formato";
import { requerirPermiso } from "@/lib/auth/guard";
import { cargarParametrosLegales } from "@/lib/payroll/parametros-bd";
import { nombreCompleto, formatCurrency, formatDate, calcularAniosTrabajados } from "@/lib/utils";
import {
  calcularIHSS,
  calcularRAP,
  calcularVacacionesDevengadas,
  calcularDiasVacaciones,
} from "@/lib/payroll/calculos-hn";
import { calcularDecimo, ventanaDevengo, type TipoDecimo } from "@/lib/payroll/decimos";
import { aNumero, minimo, sumar, sumarPor, money, redondear, CERO, type Money } from "@/lib/payroll/money";
import { aXlsx, aPdf, type ReporteTabla } from "@/lib/reportes/salida";
import { reportePuntualidad, MAX_DIAS_REPORTE } from "@/lib/asistencia/tardanzas";

export async function GET(req: NextRequest) {
  const g = await requerirPermiso("reportes.ver");
  if (!g.ok) return g.response;

  const { searchParams } = new URL(req.url);
  const reporteId = searchParams.get("reporteId") ?? "";
  const desde = searchParams.get("fechaDesde");
  const hasta = searchParams.get("fechaHasta");
  const sucursalId = searchParams.get("sucursalId") || undefined;
  const departamentoId = searchParams.get("departamentoId") || undefined;
  const formato = normalizarFormato(searchParams.get("formato"));

  // Cada reporte se aplana a filas de celdas ya formateadas: es lo que consumen
  // tanto la salida CSV como la HTML de más abajo.
  let datos: string[][] = [];
  let titulo = "Reporte NominaHN";
  let cabeceras: string[] = [];

  const whereEmp: Prisma.EmpleadoWhereInput = { estado: "ACTIVO" };
  if (sucursalId) whereEmp.sucursalId = sucursalId;
  if (departamentoId) whereEmp.departamentoId = departamentoId;

  if (reporteId === "empleados-activos") {
    const empleados = await prisma.empleado.findMany({
      where: whereEmp,
      include: { sucursal: true, departamento: true, puesto: true },
      orderBy: { primerApellido: "asc" },
    });
    titulo = "Listado de Empleados Activos";
    cabeceras = ["Código", "Nombre", "Identidad", "Sucursal", "Departamento", "Puesto", "Salario", "Ingreso", "Tipo Planilla"];
    datos = empleados.map((e) => [
      e.codigo,
      nombreCompleto(e),
      e.identidad ?? "",
      e.sucursal.nombre,
      e.departamento.nombre,
      e.puesto?.nombre ?? "",
      formatCurrency(Number(e.salarioBase)),
      formatDate(e.fechaIngreso),
      e.tipoPlanilla,
    ]);
  } else if (reporteId === "planilla-detallada" || reporteId === "resumen-planilla") {
    const wherePl: Prisma.PlanillaWhereInput = {};
    if (desde) wherePl.fechaInicio = { gte: new Date(desde) };
    if (hasta) wherePl.fechaFin = { lte: new Date(hasta) };

    const planillas = await prisma.planilla.findMany({
      where: wherePl,
      include: {
        detalles: {
          include: { empleado: { include: { sucursal: true, departamento: true } } },
          where: sucursalId ? { empleado: { sucursalId } } : departamentoId ? { empleado: { departamentoId } } : undefined,
        },
      },
      orderBy: { fechaFin: "desc" },
    });

    if (reporteId === "resumen-planilla") {
      // Antes este reporte devolvía exactamente lo mismo que planilla-detallada:
      // no agrupaba nada, pese a llamarse «resumen» y ofrecer «totales por
      // departamento y sucursal».
      titulo = "Resumen de Planilla por Sucursal y Departamento";
      cabeceras = ["Sucursal", "Departamento", "Empleados", "Bruto", "Deducciones", "Neto", "Costo Patronal"];

      const grupos = new Map<string, {
        sucursal: string; departamento: string; empleados: Set<string>;
        bruto: Money; deducciones: Money; neto: Money; patronal: Money;
      }>();

      for (const pl of planillas) {
        for (const d of pl.detalles) {
          const clave = `${d.empleado.sucursal.nombre}||${d.empleado.departamento.nombre}`;
          const cur = grupos.get(clave) ?? {
            sucursal: d.empleado.sucursal.nombre,
            departamento: d.empleado.departamento.nombre,
            empleados: new Set<string>(),
            bruto: CERO, deducciones: CERO, neto: CERO, patronal: CERO,
          };
          cur.empleados.add(d.empleadoId);
          cur.bruto = cur.bruto.plus(d.totalBruto);
          cur.deducciones = cur.deducciones.plus(d.totalDeducciones);
          cur.neto = cur.neto.plus(d.salarioNeto);
          cur.patronal = cur.patronal.plus(sumar(d.ihssEmpleador, d.rapEmpleador, d.infop, d.reservaLaboral));
          grupos.set(clave, cur);
        }
      }

      const filas = [...grupos.values()].sort(
        (a, b) => a.sucursal.localeCompare(b.sucursal) || a.departamento.localeCompare(b.departamento)
      );

      datos = filas.map((r) => [
        r.sucursal, r.departamento, String(r.empleados.size),
        formatCurrency(aNumero(r.bruto)),
        formatCurrency(aNumero(r.deducciones)),
        formatCurrency(aNumero(r.neto)),
        formatCurrency(aNumero(r.patronal)),
      ]);

      if (filas.length > 0) {
        datos.push([
          "TOTAL GENERAL", "",
          String(new Set(planillas.flatMap((p) => p.detalles.map((d) => d.empleadoId))).size),
          formatCurrency(aNumero(sumarPor(filas, (r) => r.bruto))),
          formatCurrency(aNumero(sumarPor(filas, (r) => r.deducciones))),
          formatCurrency(aNumero(sumarPor(filas, (r) => r.neto))),
          formatCurrency(aNumero(sumarPor(filas, (r) => r.patronal))),
        ]);
      }
    } else {
      titulo = "Planilla Detallada";
      cabeceras = ["Período", "Empleado", "Sucursal", "Bruto", "IHSS", "RAP", "AFP", "ISR", "Otras Ded.", "Ausencias", "Neto"];
      datos = planillas.flatMap((pl) =>
        pl.detalles.map((d) => [
          `${formatDate(pl.fechaInicio)}-${formatDate(pl.fechaFin)}`,
          nombreCompleto(d.empleado),
          d.empleado.sucursal.nombre,
          formatCurrency(aNumero(d.totalBruto)),
          formatCurrency(aNumero(d.ihssEmpleado)),
          formatCurrency(aNumero(d.rapEmpleado)),
          formatCurrency(aNumero(d.afpEmpleado)),
          formatCurrency(aNumero(d.isr)),
          formatCurrency(aNumero(sumar(d.cooperativa, d.prestamos, d.adelantos, d.otrosDeducciones))),
          formatCurrency(aNumero(d.ausencias)),
          formatCurrency(aNumero(d.salarioNeto)),
        ])
      );
    }
  } else if (reporteId === "ihss-planilla") {
    titulo = "Planilla IHSS (EM + IVM)";
    cabeceras = ["Empleado", "N° IHSS", "Salario", "Base Cotiz.", "EM Empl.", "IVM Empl.", "EM Patr.", "IVM Patr.", "Aporte Estado", "Total"];

    // Los MISMOS parámetros que la planilla (porcentaje o monto fijo), del
    // cargador compartido: el reporte al IHSS no puede decir otra cifra.
    const parametros = await cargarParametrosLegales();

    const empleados = await prisma.empleado.findMany({
      where: whereEmp,
      orderBy: { primerApellido: "asc" },
    });
    datos = empleados.map((e) => {
      const sal = e.salarioBase;
      const baseCotiz = minimo(sal, parametros.ihssTope);
      // Con el monto fijo de la ficha, igual que la planilla: si no, el reporte
      // que se presenta al IHSS diría otra cifra que la descontada.
      const ih = calcularIHSS(sal, parametros, e.ihssMontoFijo);
      const total = sumar(ih.empleado, ih.empleador, ih.ivmEstado);
      // El cálculo va en Decimal; `aNumero` solo al formatear para presentación.
      return [
        nombreCompleto(e),
        e.ihssNro ?? "",
        formatCurrency(aNumero(sal)),
        formatCurrency(aNumero(baseCotiz)),
        formatCurrency(aNumero(ih.emEmpleado)),
        formatCurrency(aNumero(ih.ivmEmpleado)),
        formatCurrency(aNumero(ih.emEmpleador)),
        formatCurrency(aNumero(ih.ivmEmpleador)),
        formatCurrency(aNumero(ih.ivmEstado)),
        formatCurrency(aNumero(total)),
      ];
    });
  } else if (reporteId === "ihss-historico") {
    titulo = "Planilla IHSS Histórica (EM + IVM)";
    cabeceras = ["Empleado", "N° IHSS", "EM Empl.", "IVM Empl.", "EM Patr.", "IVM Patr.", "Aporte Estado", "Total"];

    // Detalles de planillas del período (excluye borradores/anuladas).
    const wherePl: Prisma.PlanillaWhereInput = { estado: { in: ["CALCULADA", "APROBADA", "PAGADA"] } };
    if (desde || hasta) {
      wherePl.fechaFin = {
        ...(desde ? { gte: new Date(desde) } : {}),
        ...(hasta ? { lte: new Date(hasta) } : {}),
      };
    }

    const detalles = await prisma.planillaDetalle.findMany({
      where: {
        planilla: wherePl,
        ...(sucursalId ? { empleado: { sucursalId } } : departamentoId ? { empleado: { departamentoId } } : {}),
      },
      include: { empleado: { select: { primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true, ihssNro: true } } },
    });

    // Agregar por empleado (puede haber varias planillas en el período).
    const acc = new Map<string, { nombre: string; ihssNro: string; emEmp: number; ivmEmp: number; emPat: number; ivmPat: number; estado: number }>();
    for (const d of detalles) {
      const emEmp = Number(d.ihssEmpleado) - Number(d.ivmEmpleado);
      const emPat = Number(d.ihssEmpleador) - Number(d.ivmEmpleador);
      const cur = acc.get(d.empleadoId) ?? {
        nombre: nombreCompleto(d.empleado), ihssNro: d.empleado.ihssNro ?? "",
        emEmp: 0, ivmEmp: 0, emPat: 0, ivmPat: 0, estado: 0,
      };
      cur.emEmp += emEmp;
      cur.ivmEmp += Number(d.ivmEmpleado);
      cur.emPat += emPat;
      cur.ivmPat += Number(d.ivmEmpleador);
      cur.estado += Number(d.ivmEstado);
      acc.set(d.empleadoId, cur);
    }

    datos = [...acc.values()]
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map((r) => {
        const total = r.emEmp + r.ivmEmp + r.emPat + r.ivmPat + r.estado;
        return [
          r.nombre, r.ihssNro,
          formatCurrency(r.emEmp), formatCurrency(r.ivmEmp),
          formatCurrency(r.emPat), formatCurrency(r.ivmPat),
          formatCurrency(r.estado), formatCurrency(total),
        ];
      });
  } else if (reporteId === "puntualidad") {
    // ─── Puntualidad ──────────────────────────────────────────────────────────
    // Llegadas tarde contra el turno de cada día y días laborales sin marca
    // (descontados feriados, permisos aprobados e incapacidades). Informativo.
    if (!desde || !hasta) {
      return NextResponse.json({ error: "Indique el rango de fechas" }, { status: 400 });
    }
    const d0 = new Date(`${desde}T00:00:00Z`);
    const d1 = new Date(`${hasta}T00:00:00Z`);
    if ((d1.getTime() - d0.getTime()) / 86_400_000 + 1 > MAX_DIAS_REPORTE) {
      return NextResponse.json({ error: `El rango no puede pasar de ${MAX_DIAS_REPORTE} días` }, { status: 400 });
    }
    titulo = "Puntualidad";
    cabeceras = ["Empleado", "Sucursal", "Turno", "Días con marca", "Llegadas tarde", "Minutos tarde", "Promedio por llegada tarde", "Días laborales sin marca"];
    const filas = await reportePuntualidad(d0, d1, { sucursalId, departamentoId });
    datos = filas.map((r) => [
      r.empleado,
      r.sucursal,
      r.turno,
      String(r.diasConMarca),
      String(r.llegadasTarde),
      String(r.minutosTarde),
      r.llegadasTarde ? String(Math.round(r.minutosTarde / r.llegadasTarde)) : "0",
      String(r.diasSinMarca),
    ]);
  } else if (reporteId === "asistencia-mensual") {
    const whereMar: Prisma.MarcajeWhereInput = {};
    if (desde || hasta) {
      whereMar.fecha = {
        ...(desde ? { gte: new Date(desde) } : {}),
        ...(hasta ? { lte: new Date(hasta) } : {}),
      };
    }
    if (sucursalId) whereMar.empleado = { sucursalId };

    titulo = "Reporte de Asistencia";
    // Antes este reporte emitía el `empleadoId` crudo como nombre, la sucursal
    // en blanco y «Días Ausentes» fijo en "0".
    cabeceras = [
      "Empleado", "Sucursal", "Días Presentes", "Días Ausentes",
      "H. Extra Diurna", "H. Extra Mixta", "H. Extra Nocturna", "H. Feriado", "Total H. Extra",
    ];

    const marcajes = await prisma.marcaje.findMany({
      where: whereMar,
      select: {
        empleadoId: true,
        esAusencia: true,
        horasExtra: true,
        horasExtraDiurna: true,
        horasExtraMixta: true,
        horasExtraNocturna: true,
        horasFeriado: true,
        empleado: {
          select: {
            primerNombre: true, segundoNombre: true, primerApellido: true,
            segundoApellido: true, sucursal: { select: { nombre: true } },
          },
        },
      },
    });

    const asistencia = new Map<string, {
      nombre: string; sucursal: string; presentes: number; ausentes: number;
      diurna: number; mixta: number; nocturna: number; feriado: number; total: number;
    }>();

    for (const m of marcajes) {
      const cur = asistencia.get(m.empleadoId) ?? {
        nombre: nombreCompleto(m.empleado),
        sucursal: m.empleado.sucursal.nombre,
        presentes: 0, ausentes: 0, diurna: 0, mixta: 0, nocturna: 0, feriado: 0, total: 0,
      };
      if (m.esAusencia) cur.ausentes++;
      else cur.presentes++;
      cur.diurna += Number(m.horasExtraDiurna);
      cur.mixta += Number(m.horasExtraMixta);
      cur.nocturna += Number(m.horasExtraNocturna);
      cur.feriado += Number(m.horasFeriado);
      cur.total += Number(m.horasExtra);
      asistencia.set(m.empleadoId, cur);
    }

    datos = [...asistencia.values()]
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map((r) => [
        r.nombre, r.sucursal, String(r.presentes), String(r.ausentes),
        r.diurna.toFixed(2), r.mixta.toFixed(2), r.nocturna.toFixed(2),
        r.feriado.toFixed(2), r.total.toFixed(2),
      ]);
  } else if (reporteId === "historial-salarial") {
    titulo = "Historial Salarial";
    cabeceras = ["Empleado", "Salario Anterior", "Salario Nuevo", "Fecha Cambio", "Motivo", "Tipo"];
    const historial = await prisma.historialSalario.findMany({
      include: { empleado: true },
      orderBy: { fechaCambio: "desc" },
      take: 200,
    });
    datos = historial.map((h) => [
      nombreCompleto(h.empleado),
      formatCurrency(Number(h.salarioAnterior)),
      formatCurrency(Number(h.salarioNuevo)),
      formatDate(h.fechaCambio),
      h.motivo ?? "",
      h.tipo,
    ]);
  } else if (reporteId === "nomina-banco") {
    // ─── Dispersión bancaria ──────────────────────────────────────────────────
    // Una línea por empleado con cuenta. Sólo planillas APROBADAS o PAGADAS: no
    // se dispersa un borrador.
    const planillaId = searchParams.get("planillaId");
    if (!planillaId) {
      return NextResponse.json(
        { error: "Seleccione la planilla a dispersar antes de generar el archivo" },
        { status: 400 }
      );
    }

    const pl = await prisma.planilla.findUnique({
      where: { id: planillaId },
      include: {
        empresa: { select: { nombre: true, rtn: true } },
        detalles: {
          where: sucursalId
            ? { empleado: { sucursalId } }
            : departamentoId
              ? { empleado: { departamentoId } }
              : undefined,
          include: {
            empleado: {
              select: {
                codigo: true, identidad: true, banco: true, cuentaBancaria: true,
                primerNombre: true, segundoNombre: true,
                primerApellido: true, segundoApellido: true,
              },
            },
          },
          orderBy: { empleado: { primerApellido: "asc" } },
        },
      },
    });

    if (!pl) return NextResponse.json({ error: "Planilla no encontrada" }, { status: 404 });
    if (!["APROBADA", "PAGADA"].includes(pl.estado)) {
      return NextResponse.json(
        { error: `La planilla está ${pl.estado}: sólo se dispersa una planilla aprobada o pagada` },
        { status: 409 }
      );
    }

    // Un empleado sin cuenta no puede recibir transferencia. Se separa en vez de
    // emitir una línea inválida: el banco rechaza el lote entero por una fila.
    const pagables = pl.detalles.filter((d) => d.empleado.cuentaBancaria?.trim());
    const sinCuenta = pl.detalles.filter((d) => !d.empleado.cuentaBancaria?.trim());

    titulo = `Dispersión bancaria — ${pl.empresa.nombre}`;
    cabeceras = ["Banco", "Cuenta", "Identidad", "Beneficiario", "Monto", "Referencia"];

    const referencia = `NOM-${pl.tipo}-${formatDate(pl.fechaFin).replace(/\//g, "")}`;

    datos = pagables.map((d) => [
      d.empleado.banco ?? "",
      d.empleado.cuentaBancaria ?? "",
      d.empleado.identidad ?? "",
      nombreCompleto(d.empleado),
      // Importe CRUDO, sin símbolo ni separador de miles: los formatos de banca
      // local esperan el número plano. `formatCurrency` rompería el archivo.
      money(d.salarioNeto).toFixed(2),
      referencia,
    ]);

    // El total y los excluidos viajan en el propio archivo, que es lo que el
    // operador abre para cuadrar contra el banco.
    const totalDispersar = sumarPor(pagables, (d) => d.salarioNeto);
    datos.push(["", "", "", `TOTAL — ${pagables.length} beneficiario(s)`, totalDispersar.toFixed(2), referencia]);

    for (const d of sinCuenta) {
      datos.push([
        "", "", d.empleado.identidad ?? "",
        `EXCLUIDO (sin cuenta bancaria): ${nombreCompleto(d.empleado)}`,
        money(d.salarioNeto).toFixed(2),
        "PAGO MANUAL",
      ]);
    }
  } else if (reporteId === "rap-planilla") {
    // ─── Planilla RAP ─────────────────────────────────────────────────────────
    titulo = "Planilla RAP (Régimen de Aportaciones Privadas)";
    cabeceras = ["Empleado", "N° RAP", "Salario", "Base Cotizable", "Aporte Empleado", "Aporte Patrono", "Total"];

    // Mismo cargador que la planilla: el reporte al RAP cuadra con lo descontado.
    const parametros = await cargarParametrosLegales();

    const empleados = await prisma.empleado.findMany({
      where: whereEmp,
      orderBy: { primerApellido: "asc" },
    });

    datos = empleados.map((e) => {
      const rap = calcularRAP(e.salarioBase, parametros);
      return [
        nombreCompleto(e),
        e.rapNro ?? "",
        formatCurrency(aNumero(e.salarioBase)),
        formatCurrency(aNumero(rap.base)),
        formatCurrency(aNumero(rap.empleado)),
        formatCurrency(aNumero(rap.empleador)),
        formatCurrency(aNumero(sumar(rap.empleado, rap.empleador))),
      ];
    });
  } else if (reporteId === "isr-anual") {
    // ─── Constancia de retención de ISR ───────────────────────────────────────
    // Lo que el trabajador necesita para su declaración anual: sueldos pagados y
    // ISR efectivamente retenido en el año.
    const anio = desde ? new Date(desde).getUTCFullYear() : new Date().getUTCFullYear();
    titulo = `Constancia de Retención ISR — ${anio}`;
    cabeceras = ["Empleado", "Identidad", "RTN", "Total Devengado", "IHSS", "RAP", "AFP", "ISR Retenido"];

    const detalles = await prisma.planillaDetalle.findMany({
      where: {
        planilla: {
          estado: { in: ["APROBADA", "PAGADA"] },
          fechaFin: {
            gte: new Date(Date.UTC(anio, 0, 1)),
            lte: new Date(Date.UTC(anio, 11, 31)),
          },
        },
        ...(sucursalId ? { empleado: { sucursalId } } : departamentoId ? { empleado: { departamentoId } } : {}),
      },
      include: {
        empleado: {
          select: {
            primerNombre: true, segundoNombre: true, primerApellido: true,
            segundoApellido: true, identidad: true, rtn: true,
          },
        },
      },
    });

    // Acumular por empleado en Decimal: sumar centavos de 12 planillas en float
    // deja residuo, y esta constancia se presenta ante el SAR.
    const acc = new Map<string, {
      nombre: string; identidad: string; rtn: string;
      bruto: Money; ihss: Money; rap: Money; afp: Money; isr: Money;
    }>();

    for (const d of detalles) {
      const cur = acc.get(d.empleadoId) ?? {
        nombre: nombreCompleto(d.empleado),
        identidad: d.empleado.identidad ?? "",
        rtn: d.empleado.rtn ?? "",
        bruto: CERO, ihss: CERO, rap: CERO, afp: CERO, isr: CERO,
      };
      cur.bruto = cur.bruto.plus(d.totalBruto);
      cur.ihss = cur.ihss.plus(d.ihssEmpleado);
      cur.rap = cur.rap.plus(d.rapEmpleado);
      cur.afp = cur.afp.plus(d.afpEmpleado);
      cur.isr = cur.isr.plus(d.isr);
      acc.set(d.empleadoId, cur);
    }

    datos = [...acc.values()]
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map((r) => [
        r.nombre, r.identidad, r.rtn,
        formatCurrency(aNumero(r.bruto)),
        formatCurrency(aNumero(r.ihss)),
        formatCurrency(aNumero(r.rap)),
        formatCurrency(aNumero(r.afp)),
        formatCurrency(aNumero(r.isr)),
      ]);
  } else if (reporteId === "13vo-proyeccion" || reporteId === "14vo-proyeccion") {
    // ─── Acumulado de décimo tercer / décimo cuarto mes ───────────────────────
    const esDecimoTercero = reporteId === "13vo-proyeccion";
    const tipo: TipoDecimo = esDecimoTercero ? "DECIMO_TERCERO" : "DECIMO_CUARTO";
    const anio = desde ? new Date(desde).getUTCFullYear() : new Date().getUTCFullYear();
    const ventana = ventanaDevengo(tipo, anio);

    titulo = `${esDecimoTercero ? "Décimo Tercer" : "Décimo Cuarto"} Mes ${anio} — devengado a la fecha`;
    cabeceras = ["Empleado", "Ingreso", "Desde", "Hasta", "Días", "Salario", "Devengado", "Provisionado"];

    const empleados = await prisma.empleado.findMany({
      where: whereEmp,
      orderBy: { primerApellido: "asc" },
      select: {
        id: true, primerNombre: true, segundoNombre: true, primerApellido: true,
        segundoApellido: true, fechaIngreso: true, fechaSalida: true, salarioBase: true,
      },
    });

    // Provisión ya registrada en las planillas del año: permite contrastar el
    // devengo teórico contra lo que la contabilidad tiene apartado.
    const provisiones = await prisma.planillaDetalle.groupBy({
      by: ["empleadoId"],
      where: {
        empleadoId: { in: empleados.map((e) => e.id) },
        planilla: {
          estado: { in: ["CALCULADA", "APROBADA", "PAGADA"] },
          fechaFin: { gte: ventana.desde, lte: ventana.hasta },
        },
      },
      // Se piden ambas columnas y se elige después: un `_sum` condicional hace
      // que Prisma infiera un tipo unión sin ninguna de las dos propiedades.
      _sum: { provision13vo: true, provision14vo: true },
    });
    const provPorEmp = new Map(
      provisiones.map((p) => [
        p.empleadoId,
        money((esDecimoTercero ? p._sum.provision13vo : p._sum.provision14vo) ?? 0),
      ])
    );

    datos = empleados.map((e) => {
      const liq = calcularDecimo({
        tipo,
        anio,
        fechaIngreso: e.fechaIngreso,
        fechaSalida: e.fechaSalida,
        salarioPromedio: e.salarioBase,
      });
      return [
        nombreCompleto(e),
        formatDate(e.fechaIngreso),
        formatDate(liq.periodoDesde),
        formatDate(liq.periodoHasta),
        String(liq.diasComputados),
        formatCurrency(aNumero(e.salarioBase)),
        formatCurrency(aNumero(liq.montoDevengado)),
        formatCurrency(aNumero(provPorEmp.get(e.id) ?? CERO)),
      ];
    });
  } else if (reporteId === "vacaciones-proyeccion") {
    // ─── Provisión de vacaciones ──────────────────────────────────────────────
    titulo = "Provisión de Vacaciones por Empleado";
    cabeceras = ["Empleado", "Ingreso", "Años", "Días/Año", "Días Devengados", "Días Tomados", "Saldo", "Valor Saldo"];

    const empleados = await prisma.empleado.findMany({
      where: whereEmp,
      orderBy: { primerApellido: "asc" },
      select: {
        id: true, primerNombre: true, segundoNombre: true, primerApellido: true,
        segundoApellido: true, fechaIngreso: true, salarioBase: true,
      },
    });

    const saldos = await prisma.saldoVacaciones.findMany({
      where: { empleadoId: { in: empleados.map((e) => e.id) } },
      select: { empleadoId: true, diasTomados: true },
    });
    const tomadosPorEmp = new Map(saldos.map((s) => [s.empleadoId, Number(s.diasTomados)]));

    datos = empleados.map((e) => {
      const anios = calcularAniosTrabajados(e.fechaIngreso);
      const devengados = calcularVacacionesDevengadas(e.fechaIngreso);
      const tomados = tomadosPorEmp.get(e.id) ?? 0;
      const saldo = Math.max(0, devengados - tomados);
      // Valor del saldo = días × salario diario, en Decimal.
      const valorSaldo = redondear(money(e.salarioBase).div(30).times(saldo));
      return [
        nombreCompleto(e),
        formatDate(e.fechaIngreso),
        String(anios),
        String(calcularDiasVacaciones(anios)),
        devengados.toFixed(2),
        tomados.toFixed(2),
        saldo.toFixed(2),
        formatCurrency(aNumero(valorSaldo)),
      ];
    });
  } else if (reporteId === "evaluaciones-resumen") {
    // ─── Resumen de evaluaciones ──────────────────────────────────────────────
    titulo = "Resumen de Evaluaciones de Desempeño";
    cabeceras = ["Empleado", "Período", "Tipo", "Estado", "Calificación", "Desempeño", "Potencial", "Bono %", "Bono"];

    const evaluaciones = await prisma.evaluacion.findMany({
      where: {
        ...(desde || hasta
          ? { createdAt: { ...(desde ? { gte: new Date(desde) } : {}), ...(hasta ? { lte: new Date(hasta) } : {}) } }
          : {}),
        ...(sucursalId ? { empleado: { sucursalId } } : departamentoId ? { empleado: { departamentoId } } : {}),
      },
      include: {
        empleado: {
          select: {
            primerNombre: true, segundoNombre: true,
            primerApellido: true, segundoApellido: true,
          },
        },
      },
      orderBy: [{ periodo: "desc" }, { calificacion: "desc" }],
      take: 500,
    });

    datos = evaluaciones.map((ev) => [
      nombreCompleto(ev.empleado),
      ev.periodo,
      ev.tipo,
      ev.estado,
      Number(ev.calificacion).toFixed(2),
      ev.desempeno === null ? "" : Number(ev.desempeno).toFixed(2),
      ev.potencial === null ? "" : Number(ev.potencial).toFixed(2),
      ev.bonoPorcentaje === null ? "" : `${(Number(ev.bonoPorcentaje) * 100).toFixed(2)}%`,
      ev.bonoMonto === null ? "" : formatCurrency(Number(ev.bonoMonto)),
    ]);
  } else {
    // Un reporte que no existe se dice, no se entrega en blanco: antes caía aquí
    // y descargaba un archivo con la leyenda "Reporte en construcción".
    return NextResponse.json(
      { error: `El reporte "${reporteId || "(sin especificar)"}" no existe` },
      { status: 404 }
    );
  }

  const nombreBase = nombreArchivoSeguro(reporteId);
  const marca = new Date().toISOString().split("T")[0];

  // Filtros en palabras, para la cabecera del visor, del Excel y del PDF.
  const filtros: string[] = [];
  if (desde) filtros.push(`Desde ${formatDate(desde)}`);
  if (hasta) filtros.push(`Hasta ${formatDate(hasta)}`);
  if (sucursalId) {
    const suc = await prisma.sucursal.findUnique({ where: { id: sucursalId }, select: { nombre: true } });
    if (suc) filtros.push(`Sucursal: ${suc.nombre}`);
  }
  if (departamentoId) {
    const dep = await prisma.departamento.findUnique({ where: { id: departamentoId }, select: { nombre: true } });
    if (dep) filtros.push(`Departamento: ${dep.nombre}`);
  }
  const reporte: ReporteTabla = { titulo, cabeceras, datos, generado: new Date(), filtros };

  // La tabla tal cual, para verla dentro de la aplicación antes de exportar.
  if (formato === "JSON") {
    return NextResponse.json({ reporteId, ...reporte, total: datos.length });
  }

  if (formato === "XLSX") {
    const libro = await aXlsx(reporte);
    return new NextResponse(new Uint8Array(libro), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${nombreBase}_${marca}.xlsx"`,
      },
    });
  }

  if (formato === "PDF") {
    const pdf = await aPdf(reporte);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${nombreBase}_${marca}.pdf"`,
      },
    });
  }

  if (formato === "CSV") {
    const csvRows = [cabeceras, ...datos].map((row: string[]) => row.map(celdaCsv).join(","));
    const csv = BOM_UTF8 + csvRows.join("\r\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${nombreBase}_${marca}.csv"`,
      },
    });
  }

  // Reporte HTML: pensado para verse en el navegador o imprimirse a PDF.
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>NominaHN — ${escaparHtml(titulo)}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 11px; margin: 20px; }
  h1 { color: #1e40af; font-size: 16px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th { background: #1e40af; color: white; padding: 6px 8px; text-align: left; font-size: 10px; }
  td { padding: 5px 8px; border-bottom: 1px solid #eee; font-size: 10px; }
  tr:nth-child(even) { background: #f8f9fa; }
  .footer { margin-top: 20px; color: #666; font-size: 9px; }
</style>
</head>
<body>
<h1>NominaHN — ${escaparHtml(titulo)}</h1>
<p>Generado: ${escaparHtml(new Date().toLocaleString("es-HN"))} | Total registros: ${datos.length}</p>
<table>
<thead><tr>${cabeceras.map((h) => `<th>${escaparHtml(h)}</th>`).join("")}</tr></thead>
<tbody>
${datos.map((row: string[]) => `<tr>${row.map((c: string) => `<td>${escaparHtml(c)}</td>`).join("")}</tr>`).join("\n")}
</tbody>
</table>
<div class="footer">NominaHN · Sistema Integral de RRHH · Honduras</div>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombreBase}_${marca}.html"`,
    },
  });
}
