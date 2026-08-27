using System.Collections;
using System.Collections.Generic;
using TMPro;
using Unity.VisualScripting;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.EventSystems;
using UnityEngine.UI;

public class ShipManagerUnit : MonoBehaviour, IPointerClickHandler
{

    public Color defaultColor;
    public Color selectedColor;

    public bool subsystemDamaged;

    public Image shipImage;
    public Image bkgImage;

    public Slider healthSlider;

    public TextMeshProUGUI subsystemDamagedText;
    public TextMeshProUGUI crew;
    public TextMeshProUGUI marines;

    public TextMeshProUGUI shipName;
    public TextMeshProUGUI shipClass;

    public bool selected = false;

    ShipSave shipData;

    public ShipSave ShipData => shipData;
    public ShipCardData shipCardData;
    public FactionInfo originalFaction;

    public void Init(ShipSave ship){
        subsystemDamagedText.gameObject.SetActive(false);
        shipData = ship;

        var cm = CampaignMenu.Instance;
        originalFaction = cm.factionInfoLibrary.GetFactionInfo(ship.originalFaction);
        shipCardData = originalFaction.GetShip(ship.shipId);
        shipName.text = ship.customShipName;

        Debug.Log("ship name in fleet " + shipCardData.shipName);

        shipClass.text = shipCardData.shipType.ToString();
        shipImage.sprite = shipCardData.shipSprite;
        shipImage.color = shipCardData.factionColor;
        healthSlider.value = ship.shipHealthRemaining.ToPercent;

        crew.text = ship.remainingCrew.ToString();
        marines.text = ship.remainingMarines.ToString();

        CheckSubsystemsDamaged();
    }

    public void CheckSubsystemsDamaged(){
        var subsystemDamaged = false;

        if (!shipData.mainThruster.healthRemaining.FullHealth)
        {
            subsystemDamaged = true;
        }
        else
        {
            foreach (var system in shipData.subsystemSaves)
            {
                if (!system.healthRemaining.FullHealth)
                {
                    subsystemDamaged = true;
                    break;
                }
            }

            if (!subsystemDamaged)
            {
                foreach (var wep in shipData.weaponControllerSaves)
                {
                    if (!wep.healthRemaining.FullHealth)
                    {
                        subsystemDamaged = true;
                        break;
                    }
                }
            }
        }

        subsystemDamagedText.gameObject.SetActive(subsystemDamaged);
    }

    public void OnPointerClick(PointerEventData eventData)
    {
        if (eventData.button == PointerEventData.InputButton.Left)
        {
            CampaignMenu.Instance.fleetPanel.SelectShip(this);
        }
        Debug.Log("detected sensor click " + eventData.button);
        bkgImage.color = selectedColor;
        selected = true;
    }

    public void Deselect(){
        if(bkgImage!=null)
            bkgImage.color = defaultColor;
        selected = false;
    }

    // Start is called before the first frame update
    void Start()
    {
        
    }

    // Update is called once per frame
    void Update()
    {
        
    }
}

