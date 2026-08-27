using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEditor;
using TMPro;
using UnityEngine.EventSystems;
using UnityEngine.UI;
using System;
using Unity.VisualScripting;

[ExecuteAlways]
public class StarItemUI : MonoBehaviour, IPointerClickHandler, IPointerEnterHandler, IPointerExitHandler
{
    public TextMeshProUGUI textLabel;

    public Image selectionRing;
    public Image selectionRingPreview;
    public Image controllingFactionFlag;

    public RectTransform rectTransform => (RectTransform)transform;

    public List<RectTransform> adjacentStars;

    public List<PlanetData> solarSystem; // todo: create a library of planets so I can randomize Stuff

    public bool generatePlanets = false;

    /* Currently supported factions:
    *   - 
    */
    
    public FactionInfo controllingFaction; // null means no one lol

    public Image factionDiplomacy;

    public Image garrisonRatingImage;

    [SerializeField]
    string generatedId;

    public string ID { get { return generatedId; } }
    
    public PlanetType planetType;
    public SurfaceType surfaceType;
    public AtmosphereType atmosphereType;

    [Range(0, 5)]
    public int garrisonStrength = 0;
    public bool generateStarId = false;

    public void SetAdjacentStars(IEnumerable<RectTransform> stars){
        adjacentStars = new List<RectTransform>();
        adjacentStars.AddRange(stars);
    }

    public void SetStarAllegiance(Color color)
    {
        factionDiplomacy.color = color;
        garrisonRatingImage.fillAmount = garrisonStrength / 5f;
        garrisonRatingImage.color = color;
    }


    
    private void Awake() {
        adjacentStars = new List<RectTransform>();
        controllingFactionFlag.sprite = controllingFaction.factionIcon;
    }


    // Start is called before the first frame update
    void OnEnable()
    {
        if(textLabel == null)
        {
            textLabel = GetComponentInChildren<TextMeshProUGUI>();
        }

        textLabel.text = gameObject.name;
    }

    // Update is called once per frame
    void Update()
    {
        if(generatePlanets){
            generatePlanets = false;
            solarSystem.Clear();
            int numberOfPlanets = UnityEngine.Random.Range(1, 10);
            var navPanel = GetComponentInParent<NavigationPanel>();
            var planetTemplates = navPanel.starmapGenerator.planetDB;
            for (int i = 0; i < numberOfPlanets; i++)
            {
                var randomP = UnityEngine.Random.Range(0, planetTemplates.planetItems.Count);
                var planetRandom = planetTemplates.planetItems[randomP];
                solarSystem.Add(new PlanetData
                {
                    planetItemUI = planetRandom,
                    factionInfo = controllingFaction.shipFaction
                });
            }
        }

        if(generateStarId)
        {
            generateStarId = false;
            //generatedId = GUID.Generate().ToString();
        }
    }

    public void SetGarrisonStr(int str){
        garrisonStrength = str;
        garrisonRatingImage.fillAmount = garrisonStrength / 5f;
    }

    public void OnPointerClick(PointerEventData eventData)
    {
        Debug.Log(" clicked on star " + gameObject.name);
        selectionRing.enabled = true;
        //CampaignMenu.Instance.navigationPanel.starmapGenerator.SelectStar(this);
    }

    public void Deselect()
    {
        selectionRing.enabled = false;
    }

    public void OnPointerExit(PointerEventData eventData)
    {
        selectionRingPreview.enabled = false;
    }

    public void OnPointerEnter(PointerEventData eventData)
    {
        selectionRingPreview.enabled = true;
    }

    // #if UNITY_EDITOR
    //     private void OnDrawGizmos() {
    //         //Handles.Label(transform.position + Vector3.up * 5, gameObject.name);
    //     }

    // #endif

    public FactionStatus factionStatus => CampaignMenu.Instance.factionRepState[controllingFaction.shipFaction];

    public bool IS_VERY_HOSTILE => factionStatus.factionScore <= (int)HostileLevel.VERY_HOSTILE;
    public bool IS_HOSTILE => (factionStatus.factionScore <= (int)HostileLevel.HOSTILE) && (factionStatus.factionScore > (int)HostileLevel.VERY_HOSTILE);
    public bool IS_NEUTRAL => (factionStatus.factionScore <= (int)HostileLevel.NEUTRAL) && (factionStatus.factionScore > (int)HostileLevel.HOSTILE);
    public bool IS_FRIENDLY => (factionStatus.factionScore <= (int)HostileLevel.FRIENDLY) && (factionStatus.factionScore > (int)HostileLevel.NEUTRAL);
    public bool IS_VERY_FRIENDLY => factionStatus.factionScore > (int)HostileLevel.FRIENDLY;

}

public enum HostileLevel {
    VERY_HOSTILE = -70,
    HOSTILE = -20,
    NEUTRAL = 20,
    FRIENDLY = 70,
    VERY_FRIENDLY = 100
}