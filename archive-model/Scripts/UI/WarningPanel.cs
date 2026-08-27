using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;

public class WarningPanel : MonoBehaviour
{

    public TextMeshProUGUI warningMessageText;


    public void SetWarning(WarningMessage warningMessage)
    {
        warningMessageText.text = warningMessage.warning;
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
