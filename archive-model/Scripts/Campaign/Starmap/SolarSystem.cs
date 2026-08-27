using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class SolarSystem : MonoBehaviour
{
    public RectTransform mapContents;
    public RectTransform mainStar;

    public PlanetItemUI selectedPlanet;
    public Image planetSelector;
    public Image planetSelectorPreview;

    public Image planetPortrait;

    public TextMeshProUGUI planetName_Label;

    public Vector2 planetCursorOffset;

    private void ClearSolarSystem() {
        var transformCount = mapContents.childCount;
        for (int i = transformCount - 1; i > 0; i--)
        {
            Destroy(mapContents.GetChild(i).gameObject);
        }
    }

    public void AddPlanets(List<PlanetData> planets, ShipFaction shipFaction)
    {
        ClearSolarSystem();

        foreach(var planet in planets) {
            var planetNew = Instantiate(planet.planetItemUI, mapContents);
            planetNew.shipFaction = shipFaction;
        }
    }

    // Start is called before the first frame update
    void Start()
    {
        planetName_Label.text = "";
        planetPortrait.enabled = false;
    }

    // Update is called once per frame
    void Update()
    {
        
    }

    public void SetPlanetData(PlanetItemUI planet)
    {
        planetName_Label.text = planet.gameObject.name;
        planetPortrait.sprite = planet.sprite;
        planetPortrait.enabled = true;
        planetSelector.enabled = true;
        planetSelector.rectTransform.position = (Vector2)planet.rectTransform.position + planetCursorOffset;
        
    }

    public void ClearPlanetSelection()
    {
        planetName_Label.text = "";
        planetPortrait.sprite = null;
        planetSelector.enabled = false;
        planetPortrait.enabled = false;
    }

    public void OnHover(bool hovering, Vector2 position, PlanetItemUI planet)
    {

        if (hovering)
        {
            planetSelectorPreview.enabled = true;
            planetSelectorPreview.rectTransform.position = (Vector2)planet.rectTransform.position + planetCursorOffset;
        }
        else
        {
            planetSelectorPreview.enabled = false;

        }
    }
}
