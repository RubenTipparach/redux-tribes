using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class NavigationPanel : MonoBehaviour, ICampaignPanel
{

    public StarmapGenerator starmapGenerator;
    public Button travelButton;
    public Button endTurnButton;
    public Button combatButton;

    public TextMeshProUGUI mustAttackLabel;

    public StarmapShip starmapShip;
    public SolarSystem solarSystem;
    public ReputationWidget reputationWidget;

    Dictionary<string, StarItemUI> starById;

    public StarItemUI findStarById(string starId)
    {
        if (starById == null)
        {
            starById = new Dictionary<string, StarItemUI>();
            foreach (var star in starmapGenerator.stars)
            {
                starById.Add(star.ID, star);
            }

        }
        return starById[starId];
    }


    public void Close()
    {
        gameObject.SetActive(false);
    }

    public ICampaignPanel Open()
    {
        gameObject.SetActive(true);
        return this;
    }

    // Start is called before the first frame update
    void Start()
    {
        travelButton.interactable = false;
        combatButton.interactable = false;
        reputationWidget.SetupFactions();

    }


    // Update is called once per frame
    void Update()
    {
        
    }
}
