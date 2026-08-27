using System.Collections;
using System.Collections.Generic;
using CampaignV2;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class DataInfo : MonoBehaviour
{
    public GameObject selectionPanel;
    public TextMeshProUGUI selectionText;

    public TextMeshProUGUI shipLocationText;

    public TextMeshProUGUI travelToLocationText;
    public Button travelButton;

    public Button missionButton;
    public TextMeshProUGUI missionTitle;
    public TextMeshProUGUI missionText;

    public void SetSelection(string text)
    {
        if (text == null)
        {
            selectionPanel.SetActive(false);
            selectionText.text = "";
        }
        else
        {
            selectionPanel.SetActive(true);
            selectionText.text = text;
        }
    }



    public void SetTravelToSelection(CampaignV2.Planet location, bool canTravel = false)
    {
        if (location == null)
        {
            // selectionPanel.SetActive(false);
            travelToLocationText.text = "";
            travelButton.interactable = false;
        }
        else
        {
            travelToLocationText.text = $"{location.orbitingStar.starName} >> {location.planetName}";
            if(canTravel)
            {
                travelButton.interactable = true;
            }
        }
    }

     public void SetTravelToSelectionStar(CampaignV2.SolarSystem location, bool canTravel = false)
    {
        if (location == null)
        {
            // selectionPanel.SetActive(false);
            travelToLocationText.text = "";
            travelButton.interactable = false;
        }
        else
        {
            travelToLocationText.text = $"{location.starName}";
            if(canTravel)
            {
                travelButton.interactable = true;
            }
        }
    }

    // Start is called before the first frame update
    void Start()
    {
        travelToLocationText.text = "";
        
        SetSelection(null);

        UpdateShipLocation(false);
    }

    public void SetMissionText(Celestial location)
    {

        if (location.IsHostile && location.HasShips)
        {
            var encounterMap = CampaignMap.Instance.mapsTable[location.encounterType];
            missionButton.interactable = true;
            missionTitle.text = encounterMap.MissionTitle;
            missionText.text = encounterMap.missionDescription;

            Debug.Log($"loading mission for encounter: {location.encounterType.ToString()} | {encounterMap.MissionTitle}, {location.LocationName}");

        }
        else
        {
            missionButton.interactable = false;
        }
    }


    // todo add a quick zoom button for x,y,z
    public void UpdateShipLocation(bool traveling = false)
    {
        if (traveling)
        {
            shipLocationText.text = "... in transit ...";
        }

        else
        {
            var location = CampaignV2.CampaignMap.Instance.playerShip.atLocation;
            if (location.Type == CelestialType.Star)
            {
                shipLocationText.text = $"{location.LocationName}";

            }
            else
            {
                var planet = location as CampaignV2.Planet;
                shipLocationText.text = $"{planet.LocationName} >> {planet.system.LocationName}";

            }
            SetMissionText(location);
            Debug.Log("updating mission info");
        }
    }

    // Update is called once per frame
    void Update()
    {
        
    }
}
