# AGENT_RULES — Reglas de Agente para timp-sdd

> **Estas reglas son de cumplimiento obligatorio para cualquier agente (humano o IA) que trabaje en este repositorio.**
> Ninguna regla puede ser ignorada, relajada ni reinterpretada sin autorización explícita del propietario del proyecto.

---

## Regla 1 · Inmutabilidad de las Especificaciones

El directorio `/specs` es **de solo lectura** para los agentes.

- **Prohibido** crear, modificar, renombrar o eliminar cualquier archivo dentro de `/specs`.
- Solo se permite actuar sobre `/specs` cuando el propietario del proyecto dé una **orden explícita y específica** para hacerlo.
- Ante cualquier duda sobre si una acción modifica specs, **preguntar antes de actuar**.

> **Justificación:** En SDD las especificaciones son la fuente de verdad. Su integridad garantiza que el diseño no derive de forma silenciosa.

---

## Regla 2 · TypeScript Estricto — Tolerancia Cero con `any`

Todo el código TypeScript del proyecto (backend y frontend) debe cumplir:

- **`strict: true`** habilitado en todos los `tsconfig.json`.
- **Prohibido** el uso del tipo `any` en cualquier forma: explícita (`any`), implícita (parámetros sin tipo que resuelvan a `any`) o mediante casts (`as any`).
- Usar tipos concretos, genéricos, `unknown` + narrowing, o tipos de utilidad de TypeScript según corresponda.
- Las dependencias externas sin tipos deben envolverse en un módulo adaptador con tipado propio.

> **Justificación:** `any` anula el sistema de tipos y oculta errores que solo aparecen en producción. La disciplina de tipado es innegociable.

---

## Regla 3 · Control de Concurrencia en Reservas — Transacciones SQL Obligatorias

Toda operación que implique crear, modificar o cancelar una **reserva** debe:

- Ejecutarse dentro de una **transacción SQL** (`BEGIN … COMMIT` / `ROLLBACK`).
- Adquirir un **bloqueo adecuado** (e.g., `SELECT … FOR UPDATE`) sobre la plaza o el recurso afectado antes de modificar su estado.
- Validar la disponibilidad **dentro** de la transacción, nunca fuera de ella.
- Manejar explícitamente los conflictos de concurrencia (reintentos o error controlado al usuario).

> **Justificación:** Una app de reservas sin control de concurrencia vende la misma plaza dos veces. Esto es un defecto de negocio crítico, no un detalle técnico.

---

## Regla 4 · Código Modular y Testeable

Todo código producido debe seguir estos principios:

- **Separación de responsabilidades:** cada módulo / función tiene un propósito único y bien definido.
- **Inyección de dependencias:** las dependencias externas (base de datos, servicios, APIs) se reciben como parámetros, nunca se instancian internamente.
- **Sin efectos secundarios ocultos:** las funciones puras se prefieren siempre que sea posible; los side-effects deben ser explícitos y estar en la capa adecuada.
- **Testeabilidad por diseño:** cada módulo debe poder probarse de forma aislada con mocks/stubs de sus dependencias sin necesidad de infraestructura real.
- **Cobertura mínima:** todo módulo nuevo debe incluir (o tener previsto) al menos tests unitarios para sus caminos críticos.

> **Justificación:** El código modular reduce el acoplamiento, facilita la evolución del sistema y hace que los bugs se detecten antes de llegar a producción.

---

## Regla 5 · Seguridad por Diseño (Zero Trust)

Todo componente del sistema debe asumir que cualquier entrada es potencialmente maliciosa. Se aplican las siguientes sub-reglas sin excepción:

### 5.1 — Hashing de Contraseñas: Argon2id exclusivamente

- Las contraseñas de usuario se hashean **únicamente** con **Argon2id**.
- **Prohibido** usar bcrypt, scrypt, SHA-*, MD5, PBKDF2 u otro algoritmo de hashing para contraseñas.
- Los parámetros de Argon2id (memory cost, time cost, parallelism) deben configurarse siguiendo las recomendaciones vigentes de OWASP (mínimo: 19 MiB memoria, 2 iteraciones, 1 grado de paralelismo).
- El hash resultante se almacena en `users.password_hash`; nunca se almacena la contraseña en texto plano ni cifrada de forma reversible.

### 5.2 — Gestión de Sesiones: JWT + Refresh Token Rotatorio

- **Access Token**: JWT firmado (HS256 o RS256), duración máxima **15 minutos**. Contiene `user_id`, `role` y `exp`. No contiene información sensible.
- **Refresh Token**: valor opaco, almacenado en base de datos con referencia al usuario y fecha de expiración. Implementa **rotación obligatoria**: cada uso emite un nuevo refresh token e invalida el anterior.
- **Detección de reutilización**: si se presenta un refresh token ya rotado, se invalidan **todos** los refresh tokens del usuario (posible robo de sesión).
- **Transporte exclusivo por cookies**:
  - `HttpOnly` — impide acceso desde JavaScript.
  - `Secure` — solo se envía por HTTPS.
  - `SameSite=Strict` — protección contra CSRF.
- **Prohibido** almacenar tokens (access o refresh) en `localStorage`, `sessionStorage` o cualquier almacenamiento accesible desde JavaScript.

### 5.3 — Consultas SQL: 100% Parametrizadas

- **Toda** consulta SQL debe usar **parámetros** (`$1`, `$2`, … o placeholders del ORM/query builder).
- **Prohibida** la interpolación de strings, concatenación, o template literals para construir consultas SQL, sin excepción.
- Las cláusulas dinámicas (e.g., `ORDER BY` variable) deben resolverse con whitelists validadas en el servidor, nunca inyectando input del usuario.

### 5.4 — Autorización RBAC en Servidor

- El **`user_id`** y el **`role`** del usuario autenticado se extraen **siempre** del token JWT verificado en el servidor (middleware de autenticación).
- **Prohibido** confiar en `user_id`, `role` o cualquier dato de identidad enviado en el body, query params, headers custom o path params de la petición.
- Cada endpoint debe validar que el rol del usuario tiene permiso para la operación solicitada **antes** de ejecutar cualquier lógica de negocio.
- Los endpoints críticos (login, registro, reservas, operaciones admin) deben implementar **Rate Limiting** (e.g., por IP y/o por usuario) para mitigar ataques de fuerza bruta y abuso.

> **Justificación:** Una aplicación que gestiona datos personales, credenciales y transacciones de créditos debe diseñarse bajo el principio de Zero Trust. La seguridad no es una feature opcional, es una restricción arquitectónica que permea todo el código.

---

## Regla 6 · Minimalismo y Estructura Plana

El código debe ser directo, conciso y ceñirse estrictamente a los requerimientos:

### 6.1 — Límite de Tamaño
- **Ningún archivo de ruta o componente UI debe superar las 150 líneas de código.**
- Si un archivo excede este límite, debe simplificarse o modularizarse de forma limpia y directa.

### 6.2 — Cero Abstracciones Prematuras
- **Prohibido** crear carpetas de `services`, `controllers`, `repositories` o `utils` genéricos.
- Las rutas de Fastify ejecutan el SQL parametrizado directamente usando un único helper transaccional.

### 6.3 — Cero UI No Solicitada
- **Prohibido** añadir modales de confirmación extra, filtros no pedidos o estados redundantes en React.
- Ceñirse estrictamente a las vistas e interacciones solicitadas.

### 6.4 — Sin Comentarios Redundantes
- **Prohibido** añadir comentarios obvios que repitan lo que hace el código.

> **Justificación:** La complejidad innecesaria, la sobreingeniería y el código boilerplate oscurecen la lógica de negocio y dificultan el mantenimiento. La estructura plana y el minimalismo garantizan claridad y agilidad.

---

## Aplicación

Cualquier pull request, commit o cambio generado por un agente que viole alguna de estas reglas debe ser **rechazado** hasta que se corrija.
