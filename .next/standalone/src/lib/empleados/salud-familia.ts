/**
 * Ficha médica, familiares y beneficiarios: esquemas y acceso a la base.
 *
 * La misma lógica sirve al expediente (RRHH) y a Mi espacio (el propio
 * empleado); cada ruta decide qué partes puede leer y escribir quien llama.
 * Los familiares y beneficiarios se guardan como lista completa: lo que no
 * viene, se borra. Es lo que espera un formulario de filas editables.
 */

import { z } from "zod";
import type { PrismaClient, Prisma } from "@prisma/client";
import { validarPorcentajes } from "./familia";

type Db = PrismaClient | Prisma.TransactionClient;

const PARENTESCO = z.enum(["CONYUGE", "COMPANERO_HOGAR", "HIJO", "PADRE", "MADRE", "HERMANO", "OTRO"]);
const texto = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

export const schemaFicha = z.object({
  tipoSangre: z.enum(["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"]).optional().nullable(),
  alergias: texto(2000),
  enfermedadesCronicas: texto(2000),
  medicamentos: texto(2000),
  discapacidad: texto(300),
  medicoNombre: texto(150),
  medicoTelefono: texto(30),
  observaciones: texto(2000),
});

export const schemaFamiliar = z.object({
  nombre: z.string().trim().min(1, "requerido").max(150),
  parentesco: PARENTESCO,
  fechaNacimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal("")),
  identidad: texto(30),
  telefono: texto(30),
  esDependiente: z.boolean().optional(),
  esContactoEmergencia: z.boolean().optional(),
});

export const schemaBeneficiario = z.object({
  nombre: z.string().trim().min(1, "requerido").max(150),
  parentesco: PARENTESCO,
  identidad: texto(30),
  telefono: texto(30),
  porcentaje: z.coerce.number().positive().max(100),
});

export const schemaSaludFamilia = z.object({
  fichaMedica: schemaFicha.optional(),
  familiares: z.array(schemaFamiliar).max(30).optional(),
  beneficiarios: z.array(schemaBeneficiario).max(10).optional(),
});

export type CuerpoSaludFamilia = z.infer<typeof schemaSaludFamilia>;

export async function leerSaludFamilia(db: Db, empleadoId: string, partes: { salud: boolean; familia: boolean; beneficiarios: boolean }) {
  const [fichaMedica, familiares, beneficiarios] = await Promise.all([
    partes.salud ? db.fichaMedica.findUnique({ where: { empleadoId } }) : null,
    partes.familia ? db.familiarEmpleado.findMany({ where: { empleadoId }, orderBy: { createdAt: "asc" } }) : null,
    partes.beneficiarios ? db.beneficiarioEmpleado.findMany({ where: { empleadoId }, orderBy: { createdAt: "asc" } }) : null,
  ]);
  return {
    fichaMedica: partes.salud ? fichaMedica : undefined,
    familiares: partes.familia ? familiares : undefined,
    beneficiarios: partes.beneficiarios ? beneficiarios?.map((b) => ({ ...b, porcentaje: Number(b.porcentaje) })) : undefined,
  };
}

export class ErrorSaludFamilia extends Error {}

/** Guarda las partes presentes en el cuerpo. Quien llama ya comprobó los permisos de cada parte. */
export async function guardarSaludFamilia(db: PrismaClient, empleadoId: string, c: CuerpoSaludFamilia, actor: string | null) {
  if (c.beneficiarios) {
    const v = validarPorcentajes(c.beneficiarios.map((b) => b.porcentaje));
    if (!v.ok) throw new ErrorSaludFamilia(v.error);
  }
  await db.$transaction(async (tx) => {
    if (c.fichaMedica) {
      const datos = { ...c.fichaMedica, tipoSangre: c.fichaMedica.tipoSangre ?? null, actualizadoPor: actor };
      await tx.fichaMedica.upsert({ where: { empleadoId }, create: { empleadoId, ...datos }, update: datos });
    }
    if (c.familiares) {
      await tx.familiarEmpleado.deleteMany({ where: { empleadoId } });
      if (c.familiares.length) {
        await tx.familiarEmpleado.createMany({
          data: c.familiares.map((f) => ({
            empleadoId,
            nombre: f.nombre,
            parentesco: f.parentesco,
            fechaNacimiento: f.fechaNacimiento ? new Date(`${f.fechaNacimiento}T00:00:00Z`) : null,
            identidad: f.identidad,
            telefono: f.telefono,
            esDependiente: f.esDependiente ?? false,
            esContactoEmergencia: f.esContactoEmergencia ?? false,
          })),
        });
      }
    }
    if (c.beneficiarios) {
      await tx.beneficiarioEmpleado.deleteMany({ where: { empleadoId } });
      if (c.beneficiarios.length) {
        await tx.beneficiarioEmpleado.createMany({
          data: c.beneficiarios.map((b) => ({ empleadoId, nombre: b.nombre, parentesco: b.parentesco, identidad: b.identidad, telefono: b.telefono, porcentaje: b.porcentaje })),
        });
      }
    }
  });
}
