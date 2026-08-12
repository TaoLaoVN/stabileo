# PR21 — handoff de integración

**Rama:** `feat/pro-steel-family` · **PR** [#135](https://github.com/lambdaclass/stabileo/pull/135)
**Base:** `origin/main@542fc664`
**Estado al 2026-08-12:** capa de motor completa y testada. Faltan los diálogos de los generadores.

---

## 1. Cómo leer esta rama

Todo lo que hace está en **19 archivos nuevos**. Sobre archivos existentes hay **6 ediciones**,
todas chicas y todas justificadas abajo. Ese reparto es deliberado: #125 toca 253 archivos y
#132 toca 61, y medí la superposición antes de escribir nada.

| Archivo existente | Líneas | ¿Lo tocan? | Qué se hizo |
|---|---|---|---|
| `lib/engine/design/member-context.ts` | +55/−4 | **no** | excluir metálicos del pipeline de hormigón |
| `lib/codes/roles.ts` | +48/−4 | **no** | opción `experimental` en el catálogo |
| `lib/codes/capability.ts` | +12/−0 | **no** | 10 claves de capacidad metálica |
| `lib/templates/load-fixture.ts` | +18/−4 | **no** | passthrough de `rollAngle` |
| `lib/i18n/store.svelte.ts` | +18/−1 | **no** | fusiona los diccionarios de acero |
| `lib/store/model.svelte.ts` | +22/−10 | **sí, ambos** | extraer `fixtureApi()` de `loadExample` |
| `components/pro/ProPanel.svelte` | +5/−1 | **sí, #125** | registrar la pestaña Metálicas |
| `components/pro/ProVerificationTab.svelte` | +3/−0 | **sí, #125** | banner experimental sobre la tabla 301 |
| `lib/codes/__tests__/roles-revisions.test.ts` | +33/−2 | **no** | el test que fijaba el error rojo |

**Sólo tres archivos chocan con trabajo ajeno, y suman 30 líneas.**

---

## 2. Qué hacer cuando entre el PR #132 (perfiles y grados)

`#132` agrega `Material.gradeId`, `Section.profileFamily`, `structural-grades.ts` y
`non-metal-grades.ts`. Eso convierte una inferencia de esta rama en una declaración.

### 2.1 Conectar el catálogo de grados — 1 sitio

`lib/store/steel.svelte.ts`, dentro de `inventory()`:

```ts
      lookupGrade: undefined,   // ← reemplazar por:
      lookupGrade: (id) => {
        const g = gradeById(id);
        if (!g) return null;
        switch (g.family) {
          case 'hot-rolled':
          case 'cold-formed':
          case 'stainless':  return 'steel';
          case 'aluminium':  return 'aluminium';
          default:           return null;
        }
      },
```

Y lo mismo, si se quiere, en el `opts.lookupGrade` de `buildAllMemberContexts` — el hormigón
pasa entonces a decidirse por grado declarado en vez de por magnitud de `f'c`.

El contrato ya está testado en las dos direcciones: un grado declarado gana sobre la
magnitud, y un grado que el catálogo ya no conoce cae de nuevo en la inferencia. Ver
`steel-domain.test.ts` y `steel-excluded-from-rc.test.ts`.

**Efecto secundario esperado:** `anyInferred` pasa a `false` y el panel deja de mostrar el
aviso de "familia deducida". Eso es correcto, no una regresión.

### 2.2 Perfiles

`emit.ts` ya emite `Section.profileFamily` para perfiles simples. Hoy es una propiedad
inerte; con #132 pasa a ser el campo que ese PR define. **No hace falta tocar nada.**

Si #132 amplía el catálogo de perfiles, `profile-resolve.ts` los toma solos: resuelve por
nombre contra `ALL_PROFILES` y clasifica la simetría leyendo `FAMILY_CLASSIFICATION.series`,
así que una familia nueva queda clasificada por la misma regla sin que nadie la agregue a
mano. Lo único que hay que revisar es si alguna familia nueva es *properties-only* y
asimétrica: en ese caso `canCompose` la rechaza para perfiles múltiples, que es lo correcto,
y conviene confirmar que la razón se ve en la UI.

### 2.3 Presets de material

No los toqué, como pediste. `PLACEHOLDER_STEEL` en `emit.ts` existe sólo para que un modelo
generado tenga un material; declara `generator.assume.placeholderGrade` y desaparece en
cuanto se le pasa un grado real. Reemplazarlo es un cambio de una línea en el llamador.

---

## 3. Qué hacer cuando entre el PR #125 (PRO UI)

### 3.1 `member-context.ts` → nada

#125 no lo toca. La exclusión de metálicos entra limpia.

### 3.2 `auto-verify.ts` → borrar una constante duplicada

#125 agrega `rcCheckability()` y `CONCRETE_FY_CEILING = 80` — el mismo umbral, nombrado,
respondiendo la misma pregunta desde el lado del hormigón. Esta rama tiene
`CONCRETE_FY_CEILING` en `lib/engine/steel/material-family.ts`, con el mismo valor a
propósito.

**Después del merge**, en `auto-verify.ts`:

```ts
-const CONCRETE_FY_CEILING = 80;
+import { CONCRETE_FY_CEILING } from './steel/material-family';
```

Dos líneas. Y conviene que `rcCheckability` use `materialFamilyOf` para el caso
`notConcrete`, así el `gradeId` de #132 lo alcanza también — es un `if` de tres líneas.

### 3.3 `outcome.ts` → nada

#125 agrega `PROVISIONAL_BIAXIAL` a `DesignOutcomeKind`. Esta rama **no toca ese enum**: el
estado metálico vive en `SteelMemberStatus`, en su propio módulo. Fue una decisión, no un
descuido — un miembro de acero nunca entra al pipeline de hormigón, así que no puede producir
un outcome de hormigón, y los estados de los dos materiales tenían que quedar separados.

### 3.4 `ProPanel.svelte` → conflicto trivial

#125 reorganiza los grupos de pestañas y agrega `project`. Esta rama agrega 4 líneas:

```ts
import SteelPanel from './steel/SteelPanel.svelte';
type ProTab = … | 'steel' | …
{ id: 'steel' as ProTab, label: t('steel.panel.title') },
{:else if activeTab === 'steel'} <SteelPanel />
```

Resolución: quedarse con la estructura de #125 y volver a insertar esas cuatro. Si el ribbon
de #125 ya está, la entrada natural es el stage `design`, grupo `rc`:

```ts
{ id: 'steel', labelKey: 'steel.panel.title', icon: 'element', tab: 'steel' },
```

y sumar `steel: 'design'` al mapa `TAB_STAGE`.

### 3.5 `ProVerificationTab.svelte` → conflicto trivial

Tres líneas: el import y `<SteelExperimentalBanner />` inmediatamente debajo de
`{t('pro.cirsoc301')}`. Si #125 movió o rehízo esa tabla, el banner tiene que ir **arriba de
la tabla, no abajo** — hay un test que lo verifica por posición
(`steel-keys.test.ts`, *"sits above the CIRSOC 301 table"*).

### 3.6 `model.svelte.ts` → el único conflicto real

#125 toca las líneas 37, 714 y 1237. #132 toca las interfaces `Material` y `Section`
(~61, ~116). Esta rama extrae `fixtureApi()` alrededor de la línea 2870. **Están lejos y no
deberían chocar**, pero es el archivo con más manos encima, así que vale mirarlo.

Si el merge se complica: `fixtureApi()` puede volver a ser una copia local dentro de
`generator-apply.ts`. Se pierde la garantía de que las dos listas de bindings no diverjan,
que es justo lo que la extracción compra.

### 3.7 i18n → cero conflicto por diseño

Las ~112 claves viven en `locales/steel/{es,en}.ts` y se fusionan en `store.svelte.ts`, que
ninguno de los dos PRs toca. `es.ts` y `en.ts` quedan intactos.

**Cuando ambos hayan entrado**, fusionarlas dentro de los diccionarios principales es un
copiar y pegar, y ahí conviene traducirlas a los otros 12 idiomas (hoy caen a inglés, que es
lo que ya pasa con casi todos los namespaces fuera de `design.*`).

---

## 4. Orden recomendado

1. **#132 primero.** Superficie chica, no toca el diseño, y desbloquea §2.1.
2. **#125 después.** Es el grande.
3. **Rebase de PR21 sobre `main`**, no merge. Hoy la rama tiene 8 commits y ninguno depende
   de los otros dos PRs, así que el rebase es mecánico salvo por §3.4–3.6.
4. Correr `npm run typecheck`, `npx vitest run --project unit`, `--project build`,
   `npm run build` y `npm run check:gate`. La huella del hormigón
   (`rc-baseline-digest.test.ts`) tiene que seguir dando `1bd4d9c1d575b085`.

---

## 5. La red de seguridad, y cómo leerla si se rompe

`lib/engine/design/__tests__/rc-baseline-digest.test.ts` fija el diseño de hormigón
**miembro por miembro** sobre el pórtico de 408 barras: outcome, constraints y utilización
certificada a cuatro decimales, resumido en una huella.

El gate agregado que ya existía afirma 386/22 y es **ciego** a un cambio que mueva
utilizaciones dejando los conteos quietos. Esta huella no.

**Si falla:** cambió el diseño de hormigón. Es un defecto de esta rama hasta que se
demuestre lo contrario. No regrabar la huella para que pase — buscar qué se movió. El
archivo lo dice en su encabezado.

---

## 6. Lo que esta rama NO hace

Ordenado según tu taxonomía.

**Infraestructura lista y testada**
- Generadores de cercha (5 tipos + media cercha), columna reticulada y nave.
- Composición de perfiles múltiples (7 disposiciones) por ejes paralelos.
- Resolución de perfiles del catálogo a propiedades centroidales.
- Emisión a `JSONModel` y carga al store con procedencia y suposiciones.
- Eje de familia de material con procedencia de la clasificación.
- Estados metálicos con guardián de invariantes.
- Matriz de capacidades de CIRSOC 301, todas las facetas en `false` y todas `gate`.
- Exclusión de metálicos del pipeline de hormigón.

**Workflow experimental**
- Panel Metálicas: inventario, censo, empty states, avisos, lista de huecos.
- CIRSOC 301 seleccionable como código del proyecto, marcado experimental, sin producir nada.

**Cálculo no disponible**
- Diseño metálico. No hay adaptador ligado y no lo habrá en esta rama.

**Cálculo parcialmente implementado**
- `codes/argentina/cirsoc301.ts` y `connection-design.ts`: existen, sin tests, ahora
  etiquetados donde aparecen.

**Verificación certificable**
- Ninguna. Cero.

**Fuera de alcance, pendiente**
- Los **diálogos de los generadores** con preview 2D/3D. Los motores están listos y
  testados; falta la UI que los invoca. `applyGeneratedModel` es el punto de entrada.
- Torsión de secciones cerradas por Bredt (hoy `j: null` declarado).
- Traducción de las claves a los 12 idiomas restantes.

---

## 7. Un defecto encontrado que conviene no repetir

`steelStore` usaba un `$derived` a nivel de store. Un `$derived` así **sólo recomputa dentro
de un contexto reactivo**: leído desde una función común devuelve lo que tenía cuando se
creó, que para un store creado al importar es el inventario del modelo vacío. El test que
carga una cercha generada obtenía cero miembros mientras la función pura obtenía diecisiete.

Está reemplazado por un caché con clave `(modelVersion, hasDemands, authorityBound)`, que
lee bien en todos lados y sigue registrando la dependencia para los componentes. Vale
revisar si el mismo patrón aparece en otros stores.

---

## 8. Y una que no era un defecto

`buildSolverInput3D` compone `element.rollAngle + section.rotation`. Escribir los dos campos
para expresar una sola rotación da el doble del giro pedido — y eso era un error **mío**, en
el emisor, no del boundary: la composición es intencional y el comentario al lado lo dice.

Quedó fijado como contrato en
`lib/engine/__tests__/roll-composition-contract.test.ts`, con el porqué, para que el próximo
que lo vea no repita el diagnóstico.
