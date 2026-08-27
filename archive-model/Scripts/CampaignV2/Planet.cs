using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using System.Linq;
using System;
using Unity.VisualScripting;

namespace CampaignV2 {

    public class Planet : Celestial
    {

        public SolarSystem orbitingStar;
        public string planetName = "";

        public override string LocationName => planetName;

        public override SolarSystem system => orbitingStar;

        public PlanetType planetType;
        public SurfaceType surfaceType;
        public AtmosphereType atmosphereType;

        public bool randomEncounterScenario = true;

        public FactionInfo planetControllingFaction;

        public override bool IsAdjacentToSolarSystem(SolarSystem mySystem)
        {
            return orbitingStar.IsAdjacentToSolarSystem(mySystem);
        }

        // Start is called before the first frame update
        void Start()
        {
            if (string.IsNullOrWhiteSpace(planetName))
            {
                planetName = transform.name;
            }

            if (randomEncounterScenario)
            {
                var encounters = 6; // 0-5 is the standard, we can add more later.
                //int random = UnityEngine.Random.Range(0, encounters);

                encounterType = CampaignMap.Instance.GetRandomEncounter();//(EncounterType)random;
                SetupFaction(CampaignMenu.Instance.factionInfoLibrary, InitializeFromUI: false);
            }
            else
            {

            }
        }

        // Update is called once per frame
        void Update()
        {
            
        }
    }
}
