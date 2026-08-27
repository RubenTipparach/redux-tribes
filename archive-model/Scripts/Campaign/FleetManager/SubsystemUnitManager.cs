using System.Collections;
using System.Collections.Generic;
using CampaignV2;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class SubsystemUnitManager : MonoBehaviour
{

    public TextMeshProUGUI subsystemName;


    public SubsystemSaveData subsystemSaveData;

    ShipSave shipSave;


    public TextMeshProUGUI healthValueText;
    public Slider subsystemSlider;

    public Button repairButton;
    public TextMeshProUGUI repairText;
    public ShipManagerUnit shipUIUnit;

    public float discount = .5f;

    public void RepairSubsystem(){

        var roundUpDamage = Mathf.CeilToInt(subsystemSaveData.healthRemaining.ToDamage * discount);
        var canRepair = CampaignMenu.Instance.UpdateMoney(roundUpDamage);

        if (canRepair)
        {
            // Debug.Log("check if we can repair");
            subsystemSaveData.healthRemaining.value = subsystemSaveData.healthRemaining.initial;

            subsystemName.text = subsystemSaveData.subsystemName;
            subsystemSlider.value = subsystemSaveData.healthRemaining.ToPercent;
            repairButton.gameObject.SetActive(false);

            // do this last.
            shipUIUnit.CheckSubsystemsDamaged();
            CampaignMenu.Instance.SaveGame();

            CampaignMap.Instance.UpdateShip(shipSave);
        }
    }

    public void SetSubsystem(SubsystemSaveData subsystem, ShipSave ship, ShipManagerUnit shipThumbnail)
    {
        subsystemSaveData = subsystem;
        shipSave = ship;

        subsystemName.text = subsystem.subsystemName;
        subsystemSlider.value = subsystem.healthRemaining.ToPercent;
        shipUIUnit = shipThumbnail;
        if (subsystem.healthRemaining.FullHealth)
        {
            repairButton.gameObject.SetActive(false);
        }
        else
        {
            repairButton.gameObject.SetActive(true);
            repairText.text = $"Repair (${Mathf.CeilToInt(subsystemSaveData.healthRemaining.ToDamage * discount)})";
        }
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
