//! Canonical geometry for parametric and catalogue cross-sections.
//!
//! Every section family that can be described honestly today is turned into
//! [`SectionPolygon`] outlines here, so that one geometry drives properties,
//! meshing, stress and drawing. Nothing in this module infers a dimension: a
//! builder either receives every dimension it needs or it refuses.
//!
//! # Why this exists
//!
//! The stress path used to resolve geometry from a section's *name* (`IPE…`,
//! `HEB…`, `L\d…`) and to invent thicknesses when they were missing —
//! `tw = 0.05 b`, `tf = 0.06 h`. Measured, that produced a 40 % error in the
//! shear stress of an I-profile, silently. Requiring the dimensions makes that
//! class of defect unrepresentable rather than merely unlikely.
//!
//! # One closed outline, never overlapping rectangles
//!
//! An I-section is a single twelve-or-more-vertex loop, not three rectangles.
//! Overlapping component rectangles share edges, which seeds duplicate
//! constraint vertices in the mesher and drives the minimum triangle angle to
//! 0.76 deg — measured while validating `section::mesh`.
//!
//! # Root fillets
//!
//! Rolled I-profiles have a fillet between web and flange. Omitting it makes a
//! canonical polygon 2.4-6.0 % light on area and 2.9-5.7 % light on `Iy`
//! against published tables, so a profile without an authoritative root radius
//! is *not* representable here and stays properties-only. See
//! `web/src/lib/data/steel-profiles.ts` for the data provenance.

use serde::{Deserialize, Serialize};

use super::SectionPolygon;

/// Default arc discretization: segments per quarter circle.
///
/// Every curved boundary is polygonised, so the count is part of the geometry
/// and is recorded rather than assumed. 24 puts a solid circle within 1e-4
/// relative on area and inertia — below the rounding of published tables — and
/// the convergence tests pin the trend.
pub const DEFAULT_ARC_SEGMENTS: usize = 24;

/// How a canonical geometry was produced, carried for provenance and auditing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum GeometrySource {
    /// A rolled catalogue profile with authoritative dimensions.
    Catalogue { profile_id: String, standard: String },
    /// Dimensions entered explicitly by the user. Sharp corners are the
    /// declared shape, not an approximation of a rolled profile.
    Parametric { shape: String },
    /// Vertices supplied directly.
    Custom,
}

/// A resolved canonical section: geometry plus how it was obtained.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalGeometry {
    /// Schema version. Bumped when the wire shape changes so a stored geometry
    /// can always be interpreted by the code that reads it.
    pub version: u32,
    pub polygons: Vec<SectionPolygon>,
    pub source: GeometrySource,
    /// Segments per quarter arc used for any curved boundary.
    pub arc_segments: usize,
    /// Section rotation about its own centroid, radians, applied by consumers.
    #[serde(default)]
    pub rotation: f64,
}

pub const CANONICAL_GEOMETRY_VERSION: u32 = 1;

impl CanonicalGeometry {
    fn new(polygons: Vec<SectionPolygon>, source: GeometrySource, arc_segments: usize) -> Self {
        Self {
            version: CANONICAL_GEOMETRY_VERSION,
            polygons,
            source,
            arc_segments,
            rotation: 0.0,
        }
    }

    /// Coordinate quantum for the digest, in section units (metres): 1 pm.
    ///
    /// Coordinates are quantised before hashing rather than hashed by bit
    /// pattern, because `serde_json` does not round-trip f64 bit-exactly —
    /// measured, `0.023426254764648238` returns as `0.02342625476464824`. A
    /// bit-pattern digest therefore changes merely by crossing the wire, which
    /// would make the drawing and the numerical path disagree for no
    /// geometric reason and defeat the whole purpose of the digest.
    ///
    /// 1 pm is roughly nine orders of magnitude below any meaningful
    /// structural tolerance and about seven above the f64 round-trip noise at
    /// these magnitudes, so it absorbs serialization jitter while still
    /// changing whenever the geometry actually changes.
    const DIGEST_QUANTUM: f64 = 1e-12;

    /// Deterministic digest of the exact geometry.
    ///
    /// Lets the drawing and the numerical analysis *prove* they consumed the
    /// same section rather than assert it. FNV-1a needs no dependency, and
    /// collisions do not matter here: this is an identity check between two
    /// in-process values, not a security boundary.
    pub fn digest(&self) -> String {
        let mut h: u64 = 0xcbf2_9ce4_8422_2325;
        let mut feed = |b: u64| {
            for i in 0..8 {
                h ^= (b >> (i * 8)) & 0xff;
                h = h.wrapping_mul(0x100_0000_01b3);
            }
        };
        let quantise = |v: f64| -> u64 { ((v / Self::DIGEST_QUANTUM).round() as i64) as u64 };
        feed(self.version as u64);
        feed(self.arc_segments as u64);
        feed(quantise(self.rotation));
        for p in &self.polygons {
            feed(if p.is_void { 1 } else { 0 });
            feed(p.material_id as u64);
            feed(p.vertices.len() as u64);
            for v in &p.vertices {
                feed(quantise(v[0]));
                feed(quantise(v[1]));
            }
        }
        format!("{h:016x}")
    }
}

// ─── Primitives ────────────────────────────────────────────────────

fn require_positive(name: &str, v: f64) -> Result<f64, String> {
    if !v.is_finite() || v <= 0.0 {
        return Err(format!("{name} must be a positive, finite dimension (got {v})"));
    }
    Ok(v)
}

fn arc_points(cy: f64, cz: f64, r: f64, a0: f64, a1: f64, n: usize) -> Vec<[f64; 2]> {
    (0..=n)
        .map(|i| {
            let a = a0 + (a1 - a0) * (i as f64) / (n as f64);
            [cy + r * a.cos(), cz + r * a.sin()]
        })
        .collect()
}

fn solid(vertices: Vec<[f64; 2]>) -> SectionPolygon {
    SectionPolygon { vertices, material_id: 0, is_void: false }
}
fn void(vertices: Vec<[f64; 2]>) -> SectionPolygon {
    SectionPolygon { vertices, material_id: 0, is_void: true }
}

// ─── Builders ──────────────────────────────────────────────────────

/// Solid rectangle, centred on its centroid.
pub fn rectangle(b: f64, h: f64) -> Result<CanonicalGeometry, String> {
    let b = require_positive("b", b)?;
    let h = require_positive("h", h)?;
    let (hb, hh) = (b / 2.0, h / 2.0);
    Ok(CanonicalGeometry::new(
        vec![solid(vec![[-hb, -hh], [hb, -hh], [hb, hh], [-hb, hh]])],
        GeometrySource::Parametric { shape: "rect".into() },
        0,
    ))
}

/// Solid circle of diameter `d`.
pub fn solid_circle(d: f64, arc_segments: usize) -> Result<CanonicalGeometry, String> {
    let d = require_positive("d", d)?;
    let n = arc_segments.max(4) * 4;
    let r = d / 2.0;
    let mut v = arc_points(0.0, 0.0, r, 0.0, 2.0 * std::f64::consts::PI, n);
    v.pop(); // the closing point repeats the first
    Ok(CanonicalGeometry::new(
        vec![solid(v)],
        GeometrySource::Parametric { shape: "circle".into() },
        arc_segments,
    ))
}

/// Circular hollow section from outer diameter and wall thickness.
///
/// Fully determined by `d` and `t` — no fillet or corner data is involved,
/// which is why CHS is geometry-backed for the whole catalogue.
pub fn circular_hollow(d: f64, t: f64, arc_segments: usize) -> Result<CanonicalGeometry, String> {
    let d = require_positive("d", d)?;
    let t = require_positive("t", t)?;
    let r = d / 2.0;
    if t >= r {
        return Err(format!("wall thickness {t} must be smaller than the radius {r}"));
    }
    let n = arc_segments.max(4) * 4;
    let full = 2.0 * std::f64::consts::PI;
    let mut outer = arc_points(0.0, 0.0, r, 0.0, full, n);
    outer.pop();
    let mut inner = arc_points(0.0, 0.0, r - t, 0.0, full, n);
    inner.pop();
    Ok(CanonicalGeometry::new(
        vec![solid(outer), void(inner)],
        GeometrySource::Parametric { shape: "chs".into() },
        arc_segments,
    ))
}

/// Doubly-symmetric I/H outline with parallel flanges.
///
/// `root_radius` may be zero for a fabricated/welded section whose corners
/// really are sharp. For a *rolled* profile it must be the authoritative value:
/// omitting the fillets costs 2.4-6.0 % of the area.
pub fn i_section(
    h: f64,
    b: f64,
    tw: f64,
    tf: f64,
    root_radius: f64,
    arc_segments: usize,
    source: GeometrySource,
) -> Result<CanonicalGeometry, String> {
    let h = require_positive("h", h)?;
    let b = require_positive("b", b)?;
    let tw = require_positive("tw", tw)?;
    let tf = require_positive("tf", tf)?;
    if !root_radius.is_finite() || root_radius < 0.0 {
        return Err(format!("root radius must be finite and non-negative (got {root_radius})"));
    }
    if 2.0 * tf >= h {
        return Err("flange thickness leaves no web".into());
    }
    if tw >= b {
        return Err("web is wider than the flange".into());
    }
    let (hb, bb, tb) = (h / 2.0, b / 2.0, tw / 2.0);
    let (zb, zt) = (-hb + tf, hb - tf);
    let r = root_radius.min((zt - zb) / 2.0).min(bb - tb);
    let pi = std::f64::consts::PI;
    let n = arc_segments.max(1);

    let mut v: Vec<[f64; 2]> = vec![[-bb, -hb], [bb, -hb], [bb, zb]];
    if r > 0.0 {
        // Concave quarter fillets, tangent to the flange underside and web face.
        v.extend(arc_points(tb + r, zb + r, r, -pi / 2.0, -pi, n));
        v.extend(arc_points(tb + r, zt - r, r, pi, pi / 2.0, n));
    } else {
        v.push([tb, zb]);
        v.push([tb, zt]);
    }
    v.extend([[bb, zt], [bb, hb], [-bb, hb], [-bb, zt]]);
    if r > 0.0 {
        v.extend(arc_points(-tb - r, zt - r, r, pi / 2.0, 0.0, n));
        v.extend(arc_points(-tb - r, zb + r, r, 0.0, -pi / 2.0, n));
    } else {
        v.push([-tb, zt]);
        v.push([-tb, zb]);
    }
    v.push([-bb, zb]);

    Ok(CanonicalGeometry::new(vec![solid(v)], source, arc_segments))
}

/// Sharp-cornered T outline: flange on top, web below, centred on the bounding box.
pub fn tee_section(h: f64, b: f64, tw: f64, tf: f64) -> Result<CanonicalGeometry, String> {
    let h = require_positive("h", h)?;
    let b = require_positive("b", b)?;
    let tw = require_positive("tw", tw)?;
    let tf = require_positive("tf", tf)?;
    if tf >= h {
        return Err("flange thickness leaves no web".into());
    }
    if tw > b {
        return Err("web is wider than the flange".into());
    }
    let (hb, bb, tb) = (h / 2.0, b / 2.0, tw / 2.0);
    Ok(CanonicalGeometry::new(
        vec![solid(vec![
            [-tb, -hb], [tb, -hb], [tb, hb - tf], [bb, hb - tf],
            [bb, hb], [-bb, hb], [-bb, hb - tf], [-tb, hb - tf],
        ])],
        GeometrySource::Parametric { shape: "tee".into() },
        0,
    ))
}

/// Sharp-cornered angle outline with the corner at the origin.
pub fn angle_section(h: f64, b: f64, t: f64) -> Result<CanonicalGeometry, String> {
    let h = require_positive("h", h)?;
    let b = require_positive("b", b)?;
    let t = require_positive("t", t)?;
    if t >= h || t >= b {
        return Err("leg thickness must be smaller than both legs".into());
    }
    Ok(CanonicalGeometry::new(
        vec![solid(vec![[0.0, 0.0], [b, 0.0], [b, t], [t, t], [t, h], [0.0, h]])],
        GeometrySource::Parametric { shape: "angle".into() },
        0,
    ))
}

/// Sharp-cornered channel outline, web on the left.
pub fn channel_section(h: f64, b: f64, tw: f64, tf: f64) -> Result<CanonicalGeometry, String> {
    let h = require_positive("h", h)?;
    let b = require_positive("b", b)?;
    let tw = require_positive("tw", tw)?;
    let tf = require_positive("tf", tf)?;
    if 2.0 * tf >= h {
        return Err("flange thickness leaves no web".into());
    }
    if tw >= b {
        return Err("web is thicker than the flange is wide".into());
    }
    let hh = h / 2.0;
    Ok(CanonicalGeometry::new(
        vec![solid(vec![
            [0.0, -hh], [b, -hh], [b, -hh + tf], [tw, -hh + tf],
            [tw, hh - tf], [b, hh - tf], [b, hh], [0.0, hh],
        ])],
        GeometrySource::Parametric { shape: "channel".into() },
        0,
    ))
}

/// Sharp-cornered rectangular hollow section.
///
/// Rolled RHS have rounded corners; this builder is for a section the user
/// explicitly declares as sharp. A rolled catalogue RHS needs authoritative
/// outer *and* inner corner radii and is not representable here yet.
pub fn rectangular_hollow(b: f64, h: f64, t: f64) -> Result<CanonicalGeometry, String> {
    let b = require_positive("b", b)?;
    let h = require_positive("h", h)?;
    let t = require_positive("t", t)?;
    if 2.0 * t >= b.min(h) {
        return Err("wall thickness leaves no cavity".into());
    }
    let (hb, hh) = (b / 2.0, h / 2.0);
    let (ib, ih) = (hb - t, hh - t);
    Ok(CanonicalGeometry::new(
        vec![
            solid(vec![[-hb, -hh], [hb, -hh], [hb, hh], [-hb, hh]]),
            void(vec![[-ib, -ih], [ib, -ih], [ib, ih], [-ib, ih]]),
        ],
        GeometrySource::Parametric { shape: "rhs".into() },
        0,
    ))
}

/// Custom outline with optional holes, supplied by the caller.
pub fn custom(outer: Vec<[f64; 2]>, holes: Vec<Vec<[f64; 2]>>) -> Result<CanonicalGeometry, String> {
    if outer.len() < 3 {
        return Err("outer boundary needs at least 3 vertices".into());
    }
    for v in outer.iter().chain(holes.iter().flatten()) {
        if !v[0].is_finite() || !v[1].is_finite() {
            return Err("geometry has non-finite coordinates".into());
        }
    }
    let mut polys = vec![solid(outer)];
    for h in holes {
        if h.len() < 3 {
            return Err("a hole needs at least 3 vertices".into());
        }
        polys.push(void(h));
    }
    Ok(CanonicalGeometry::new(polys, GeometrySource::Custom, 0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::section::{analyze_section, SectionInput};

    fn props(g: &CanonicalGeometry) -> crate::section::SectionProperties {
        analyze_section(&SectionInput { polygons: g.polygons.clone(), modular_ratios: Default::default() }).unwrap()
    }
    fn rel(got: f64, exp: f64) -> f64 {
        if exp == 0.0 { got.abs() } else { ((got - exp) / exp).abs() }
    }

    #[test]
    fn rectangle_is_exact() {
        let g = rectangle(0.2, 0.4).unwrap();
        let p = props(&g);
        assert!(rel(p.a, 0.08) < 1e-15);
        assert!(rel(p.iy, 0.2 * 0.4f64.powi(3) / 12.0) < 1e-14);
        assert!(rel(p.iz, 0.4 * 0.2f64.powi(3) / 12.0) < 1e-14);
        assert!(p.iyz.abs() < 1e-18);
    }

    #[test]
    fn solid_circle_converges_to_the_analytic_disc() {
        let d: f64 = 0.3;
        let (ea, ei) = (std::f64::consts::PI * (d / 2.0).powi(2), std::f64::consts::PI * (d / 2.0).powi(4) / 4.0);
        let mut prev = f64::INFINITY;
        for &n in &[6usize, 12, 24, 48] {
            let p = props(&solid_circle(d, n).unwrap());
            let e = rel(p.a, ea);
            assert!(e < prev, "area error must fall with refinement");
            prev = e;
            if n >= 24 {
                // An inscribed n-gon under-reports area by about pi^2/(3 n^2);
                // at n = 24 quarter-segments (96 sides) that is ~3.6e-4.
                let sides = (n * 4) as f64;
                let bound = 4.0 * std::f64::consts::PI.powi(2) / (3.0 * sides * sides);
                assert!(rel(p.a, ea) < bound, "n={n}: area error {} exceeds {bound}", rel(p.a, ea));
                assert!(rel(p.iy, ei) < 3.0 * bound, "n={n}: inertia error {}", rel(p.iy, ei));
            }
        }
    }

    #[test]
    fn chs_matches_the_exact_annulus() {
        // CHS 48.3x3.2 — one of the six whose published inertia was wrong.
        let (d, t) = (0.0483, 0.0032);
        let p = props(&circular_hollow(d, t, 64).unwrap());
        let (r, ri) = (d / 2.0, d / 2.0 - t);
        let a = std::f64::consts::PI * (r * r - ri * ri);
        let i = std::f64::consts::PI * (r.powi(4) - ri.powi(4)) / 4.0;
        // 64 quarter-segments = 256 sides; the inscribed-polygon bound is ~2e-5.
        assert!(rel(p.a, a) < 2e-4, "A {} vs {a}", p.a);
        assert!(rel(p.iy, i) < 4e-4, "Iy {} vs {i}", p.iy);
        // The corrected catalogue value, in cm^4.
        assert!(rel(p.iy * 1e8, 11.59) < 2e-3, "corrected catalogue Iy");
        // And decisively NOT the old wrong one.
        assert!(rel(p.iy * 1e8, 12.30) > 0.05, "must not reproduce the superseded value");
        assert!(rel(p.iy, p.iz) < 1e-9, "a tube is isotropic in bending");
    }

    /// The published values these polygons must reproduce.
    /// h, b, tw, tf, r in mm; a in cm^2; iy, iz in cm^4.
    const ROLLED: &[(&str, f64, f64, f64, f64, f64, f64, f64, f64)] = &[
        ("IPE 80", 80.0, 46.0, 3.8, 5.2, 5.0, 7.64, 80.1, 8.49),
        ("IPE 300", 300.0, 150.0, 7.1, 10.7, 15.0, 53.8, 8356.0, 604.0),
        ("IPE 600", 600.0, 220.0, 12.0, 19.0, 24.0, 156.0, 92080.0, 3387.0),
        ("HEB 200", 200.0, 200.0, 9.0, 15.0, 18.0, 78.1, 5696.0, 2003.0),
        // HEA are shallow: HEA 300 is 290 mm deep, the 300 naming the series.
        ("HEA 300", 290.0, 300.0, 8.5, 14.0, 27.0, 113.0, 18260.0, 6310.0),
    ];

    #[test]
    fn rolled_profiles_reproduce_published_properties_with_root_fillets() {
        // Tolerance justification: published A and I carry three significant
        // figures (53.8 cm^2, 8356 cm^4), so ~0.1-0.5 % is already inherent in
        // the reference. 0.6 % leaves room for that plus arc discretization
        // without being loose enough to hide a missing fillet, which costs
        // 2.4-6.0 %.
        const TOL: f64 = 6e-3;
        for &(name, h, b, tw, tf, r, a, iy, iz) in ROLLED {
            let g = i_section(
                h / 1000.0, b / 1000.0, tw / 1000.0, tf / 1000.0, r / 1000.0,
                DEFAULT_ARC_SEGMENTS,
                GeometrySource::Catalogue { profile_id: name.into(), standard: "EN 10365".into() },
            )
            .unwrap();
            let p = props(&g);
            assert!(rel(p.a * 1e4, a) < TOL, "{name} A {:.3} vs {a}", p.a * 1e4);
            assert!(rel(p.iy * 1e8, iy) < TOL, "{name} Iy {:.1} vs {iy}", p.iy * 1e8);
            assert!(rel(p.iz * 1e8, iz) < TOL, "{name} Iz {:.1} vs {iz}", p.iz * 1e8);
            assert!(p.iyz.abs() / p.iy < 1e-9, "{name} is doubly symmetric");
        }
    }

    #[test]
    fn omitting_the_root_fillet_is_detectably_wrong() {
        // Guards the tolerance above: it must be tight enough that a sharp
        // outline fails. This is the S1 defect made unrepresentable.
        let (h, b, tw, tf) = (0.300, 0.150, 0.0071, 0.0107);
        let sharp = props(&i_section(h, b, tw, tf, 0.0, DEFAULT_ARC_SEGMENTS,
            GeometrySource::Parametric { shape: "i".into() }).unwrap());
        let filleted = props(&i_section(h, b, tw, tf, 0.015, DEFAULT_ARC_SEGMENTS,
            GeometrySource::Catalogue { profile_id: "IPE 300".into(), standard: "EN 10365".into() }).unwrap());
        assert!(rel(sharp.a * 1e4, 53.8) > 6e-3, "sharp outline must miss the published area");
        assert!(rel(filleted.a * 1e4, 53.8) < 6e-3);
        assert!(filleted.a > sharp.a, "fillets add material");
    }

    #[test]
    fn angle_has_non_principal_geometric_axes() {
        // The case the old stress path treated as if its geometric axes were
        // principal. Equal legs put the principal axes at exactly 45 deg.
        let p = props(&angle_section(0.100, 0.100, 0.010).unwrap());
        assert!(p.iyz.abs() > 1e-9, "an angle must have a non-zero product of inertia");
        assert!((p.theta_p.to_degrees().abs() - 45.0).abs() < 1e-6, "theta_p {}", p.theta_p.to_degrees());
        assert!(rel(p.i1 + p.i2, p.iy + p.iz) < 1e-12, "trace invariant");
        assert!(p.i1 > p.iy && p.i2 < p.iz, "principal inertias must bracket the geometric ones");
    }

    #[test]
    fn tee_and_channel_build_as_single_outlines() {
        let t = props(&tee_section(0.30, 0.30, 0.10, 0.15).unwrap());
        assert!(rel(t.a, 0.30 * 0.15 + 0.10 * 0.15) < 1e-14);
        assert!(t.zc.abs() > 1e-6, "a tee's centroid is off the mid-height");

        let c = props(&channel_section(0.20, 0.075, 0.0085, 0.0115).unwrap());
        let exact = 0.20 * 0.0085 + 2.0 * (0.075 - 0.0085) * 0.0115;
        assert!(rel(c.a, exact) < 1e-12, "channel area {} vs {exact}", c.a);
        assert!(c.yc > 0.0, "a channel's centroid sits toward the flanges");
    }

    #[test]
    fn rhs_subtracts_its_cavity() {
        let p = props(&rectangular_hollow(0.10, 0.20, 0.008).unwrap());
        assert!(rel(p.a, 0.1 * 0.2 - 0.084 * 0.184) < 1e-14);
        assert!(rel(p.iy, (0.1 * 0.2f64.powi(3) - 0.084 * 0.184f64.powi(3)) / 12.0) < 1e-13);
    }

    #[test]
    fn custom_geometry_with_a_hole() {
        let g = custom(
            vec![[0.0, 0.0], [0.2, 0.0], [0.2, 0.3], [0.0, 0.3]],
            vec![vec![[0.05, 0.05], [0.15, 0.05], [0.15, 0.25], [0.05, 0.25]]],
        )
        .unwrap();
        let p = props(&g);
        assert!(rel(p.a, 0.2 * 0.3 - 0.1 * 0.2) < 1e-14);
        assert_eq!(g.polygons.len(), 2);
        assert!(g.polygons[1].is_void);
    }

    #[test]
    fn builders_refuse_missing_or_impossible_dimensions() {
        assert!(rectangle(0.0, 0.4).is_err());
        assert!(rectangle(0.2, f64::NAN).is_err());
        assert!(solid_circle(-1.0, 24).is_err());
        assert!(circular_hollow(0.05, 0.05, 24).is_err(), "wall thicker than the radius");
        assert!(i_section(0.3, 0.15, 0.0071, 0.2, 0.0, 24, GeometrySource::Custom).is_err(), "flange eats the web");
        assert!(i_section(0.3, 0.005, 0.0071, 0.0107, 0.0, 24, GeometrySource::Custom).is_err(), "web wider than flange");
        assert!(i_section(0.3, 0.15, 0.0071, 0.0107, -1.0, 24, GeometrySource::Custom).is_err(), "negative radius");
        assert!(angle_section(0.1, 0.1, 0.2).is_err(), "leg thinner than its thickness");
        assert!(rectangular_hollow(0.1, 0.2, 0.06).is_err(), "no cavity left");
        assert!(custom(vec![[0.0, 0.0], [1.0, 0.0]], vec![]).is_err(), "degenerate outline");
    }

    #[test]
    fn digest_is_deterministic_and_geometry_sensitive() {
        let a = rectangle(0.2, 0.4).unwrap();
        let b = rectangle(0.2, 0.4).unwrap();
        assert_eq!(a.digest(), b.digest(), "same geometry must digest identically");

        let c = rectangle(0.2, 0.4000001).unwrap();
        assert_ne!(a.digest(), c.digest(), "a geometry change must change the digest");
        // Sensitive well below any structural tolerance, but not to f64 noise.
        let fine = rectangle(0.2, 0.4 + 1e-9).unwrap();
        assert_ne!(a.digest(), fine.digest(), "a nanometre change is still a change");

        let mut d = rectangle(0.2, 0.4).unwrap();
        d.rotation = 0.1;
        assert_ne!(a.digest(), d.digest(), "rotation is part of the identity");

        // Discretization is part of the geometry, so it is part of the digest.
        assert_ne!(solid_circle(0.3, 12).unwrap().digest(), solid_circle(0.3, 24).unwrap().digest());
    }

    #[test]
    fn renaming_a_profile_cannot_change_its_geometry() {
        // Geometry comes from dimensions only; the identifier is provenance.
        let mk = |id: &str| {
            i_section(0.300, 0.150, 0.0071, 0.0107, 0.015, DEFAULT_ARC_SEGMENTS,
                GeometrySource::Catalogue { profile_id: id.into(), standard: "EN 10365".into() }).unwrap()
        };
        let a = mk("IPE 300");
        let b = mk("Main beam");
        assert_eq!(a.digest(), b.digest(), "the name must not enter the geometry");
        assert_eq!(a.polygons[0].vertices, b.polygons[0].vertices);
    }

    #[test]
    fn arc_discretization_is_recorded_not_assumed() {
        let g = circular_hollow(0.0483, 0.0032, 32).unwrap();
        assert_eq!(g.arc_segments, 32);
        assert_eq!(g.version, CANONICAL_GEOMETRY_VERSION);
        // Round-trips through the wire unchanged. This is the property the
        // drawing depends on: it receives geometry as JSON and must arrive at
        // the same digest the numerical path computed in Rust.
        let json = serde_json::to_string(&g).unwrap();
        let back: CanonicalGeometry = serde_json::from_str(&json).unwrap();
        assert_eq!(back.digest(), g.digest(), "digest must survive serialization");
        assert_eq!(back.arc_segments, 32);
        // Double round-trip too, so the format is a fixed point.
        let twice: CanonicalGeometry = serde_json::from_str(&serde_json::to_string(&back).unwrap()).unwrap();
        assert_eq!(twice.digest(), g.digest());
    }
}
