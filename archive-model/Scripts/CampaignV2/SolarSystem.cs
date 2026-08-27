using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using Shapes;
using UnityEditor;
using System;

namespace CampaignV2
{

    public interface TravelLocation {
        string LocationName { get; }
        SolarSystem SolarSystem { get; }

        bool IsAdjacentToSolarSystem(SolarSystem mySystem);
    }

    [ExecuteInEditMode]
    public class SolarSystem : Celestial
    {
        public ShapeSpaceUtilities shapeSpaceUtilities;
        public Planet[] planets; // include asteroids, planetoids, moons, and Langrange? points.
        public CustomLineProperties customLineProperties;
        public CustomLineProperties connectionLines;
        public DiscColorsProp solarSystemPlaneProps;
        public CustomLineProperties systemBorderColor;

        public List<SolarSystem> systemConnections;
        public List<SolarSystem> backConnections;

        public float systemRadius = 5;
        public float systemThicknessRadius = 1;

        public string starName = "";

        public override string LocationName => starName;

        public override SolarSystem system => this;


        void DrawPlanets()
        {

            // check for null stuff
            if (customLineProperties == null || connectionLines == null
                || solarSystemPlaneProps == null || solarSystemPlaneProps == null
                || systemBorderColor == null)
                return;

            foreach (var p in planets)
            {
                var distance = Vector3.Distance(p.transform.position, transform.position);
                Draw.LineGeometry = customLineProperties.lineGeometry;
                Draw.ThicknessSpace = customLineProperties.thicknessSpace;
                // Draw.Color = customLineProperties.color;
                //Draw.Disc(distance);

                Draw.Ring(pos: transform.position,
                    normal: Vector3.up,
                    radius: distance,
                    thickness: customLineProperties.thickness,
                    colors: customLineProperties.color);
            }

            // Draw system bounds
            Draw.Arc(pos: transform.position,
                angleRadStart: 0,
                angleRadEnd: 360,
                normal: Vector3.up,
                radius: systemRadius - systemThicknessRadius / 2f,
                thickness: systemThicknessRadius,
                colors: DiscColors.Radial(solarSystemPlaneProps.innerStart, solarSystemPlaneProps.innerEnd));


            Draw.LineGeometry = systemBorderColor.lineGeometry;
            Draw.ThicknessSpace = systemBorderColor.thicknessSpace;
            Draw.Thickness = systemBorderColor.thickness;
            Draw.Ring(pos: transform.position,
                normal: Vector3.up,
                radius: systemRadius,
                thickness: systemBorderColor.thickness,
                colors: systemBorderColor.color);

            Draw.LineGeometry = connectionLines.lineGeometry;
            Draw.ThicknessSpace = connectionLines.thicknessSpace;
            Draw.Thickness = connectionLines.thickness;
            foreach (var c in systemConnections)
            {
                if (c == null) return;
                var start = transform.position;
                var end = c.transform.position;
                var offset = start - end;
                offset = offset.normalized * systemRadius;
                Draw.Color = connectionLines.color;
                Draw.Line(transform.position - offset, c.transform.position + offset);
            }


        }

        // This only works on the source Solar system, it will autogenerate other systems and provide them with return nodes.
        public void PopulateBackConnections()
        {
            Debug.Log("populating system connections");

            if (systemConnections == null)
            {
                systemConnections = new List<SolarSystem>();
            }

            if (backConnections == null)
            {
                backConnections = new List<SolarSystem>();
            }

            foreach (var system in systemConnections)
            {
                system.AddBackConnection(this);
            }
        }

        public void AddBackConnection(SolarSystem system)
        {
            if (backConnections == null)
            {
                backConnections = new List<SolarSystem>();
            }


            if (!backConnections.Contains(system))
            {
                backConnections.Add(system);
            }
        }

        void OnEnable()
        {
            shapeSpaceUtilities.drawCmd += DrawPlanets;

            InitPlanets();

            if (hasStation)
            {
                encounterType = EncounterType.Starbase_Assault;
            }
        }

        void InitPlanets()
        {
            if (planets != null)
            {
                foreach (var p in planets)
                {
                    p.orbitingStar = this;
                }
            }
        }

        // Start is called before the first frame update
        void Start()
        {
            shapeSpaceUtilities.drawCmd += DrawPlanets;

            if (string.IsNullOrWhiteSpace(starName))
            {
                starName = transform.name;
            }

            InitPlanets();
        }

        // Update is called once per frame
        void Update()
        {
        }


#if UNITY_EDITOR
        public void GeneartePlanetIds()
        {
            var s = this;
            var gm = CampaignMap.Instance;
            if (string.IsNullOrEmpty(s.guid))
            {
                s.guid = GUID.Generate().ToString();
                EditorUtility.SetDirty(s);
                PrefabUtility.RecordPrefabInstancePropertyModifications(s);
            }
            s.InitializeFromUI(gm.factionInfoLibrary);

            foreach (var p in s.planets)
            {
                //if (string.IsNullOrEmpty(p.guid))
                //{
                    p.guid = GUID.Generate().ToString();
                    EditorUtility.SetDirty(p);
                    PrefabUtility.RecordPrefabInstancePropertyModifications(p);
                //}

                p.InitializeFromUI(gm.factionInfoLibrary);
            }

        }

        public void GenerateDummyShips()
        {

            var s = this;
            foreach (var p in s.planets)
            {
                foreach (var b1 in p.battleGroups)
                {
                    b1.battlegroupId = GUID.Generate().ToString();

                    foreach (var b2 in b1.ships)
                    {
                        b2.shipId = GUID.Generate().ToString();
                    }
                }
                EditorUtility.SetDirty(p);
                PrefabUtility.RecordPrefabInstancePropertyModifications(p);
            }
        }
#endif
    }
}