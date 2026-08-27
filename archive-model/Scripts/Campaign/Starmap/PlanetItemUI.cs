using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;

public class PlanetItemUI : MonoBehaviour, IPointerClickHandler, IPointerEnterHandler, IPointerExitHandler
{
    public PlanetType planetType;
    public SurfaceType surfaceType;
    public AtmosphereType atmosphereType;

    public RectTransform rectTransform => (RectTransform)transform;
    public Sprite sprite;

    public ShipFaction shipFaction;

    public string planetId;

    // Start is called before the first frame update
    void Start()
    {
        
    }

    // Update is called once per frame
    void Update()
    {
        
    }

    public void OnPointerClick(PointerEventData eventData)
    {
        // CampaignMenu.Instance.navigationPanel.solarSystem
        //     .SetPlanetData(this);
    }

    public void OnPointerEnter(PointerEventData eventData)
    {
        // CampaignMenu.Instance.navigationPanel.solarSystem.OnHover(true,
        //  rectTransform.position, this);
    }

    public void OnPointerExit(PointerEventData eventData)
    {
        // CampaignMenu.Instance.navigationPanel.solarSystem.OnHover(false,
        //  rectTransform.position, this);
    }

}

[Serializable]
public class PlanetData
{
    public string id = Guid.NewGuid().ToString();

    public PlanetItemUI planetItemUI;
    public ShipFaction factionInfo;
    public bool hasStation = false;
    public bool hasGarrison = false;
    public bool visited = false;

    public GarrisonFleet garrisonFleet;
}

[Serializable]
public class GarrisonFleet{
    public int Gunships = 0;
    public int Frigates = 0;
    public int Destroyers = 0;
    public int BattleShips = 0;
}

public enum PlanetType {
    ASTEROID = 0,
    SUB_PLANET = 1,
    SUB_EARTH  = 2,
    EARTH_SIZE = 3,
    SUPER_EARTH = 4,
    SUB_JUPITER = 5,
    JUPITER = 6,
    SUPER_JUPITER = 7
}

public enum SurfaceType {
    ROCKY,
    ICY,
    LAVA,
    WATER_WORLD,
    EARTH_LIKE,
    GAS,
    VOLCANIC
}

public enum AtmosphereType {
    NONE,
    HYDROGEN,
    OXYGEN_NITROGEN,
    METHANE,
    SULFURIC,
    CARBON,
    OTHER_GAS,
    UNKNOWN

}
